import { withTransaction } from '../db/pool.js';
import { newId } from '../ids.js';
import { lockEvent } from '../events/repo.js';
import { decide } from '../gateway/simulated.js';
import { generateTicketCode } from './code.js';
import { occupiedSeats } from './availability.js';
import { insertPaymentAttempt, insertTicket } from './repo.js';

// Compra de ingresso (F03.P2) — mesma função para a vitrine (channel 'web') e a API de parceiros ('partner').
//
//   purchaseTicket({ eventId, userId = null, buyerEmail, cardNumber, channel })
//     → { ok: true, ticket, attempt } | { ok: false, error: 'invalid_request' | 'event_not_available' | 'sold_out' }
//
// Ordem dos erros: invalid_request (antes da transação) → event_not_available → sold_out.
// R07: numa única transação, trava a linha do evento (SELECT ... FOR UPDATE), conta pendentes + confirmados e só
// então insere. Compras do mesmo evento serializam no lock; edição de lotação (R03) e cancelamento (F06) usam o
// mesmo lock. Retorna sem esperar o gateway: a resposta fica em payment_attempts.respond_at e o worker aplica.

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const CARD_RE = /^\d{16}$/;
export const CHANNELS = Object.freeze(['web', 'partner']);
const MAX_CODE_ATTEMPTS = 5;

// Ouvintes chamados após o COMMIT de cada compra (o worker agenda um setTimeout para respond_at).
const committedListeners = new Set();
export function onPurchaseCommitted(fn) {
  committedListeners.add(fn);
  return () => committedListeners.delete(fn);
}

export function validatePurchaseInput({ buyerEmail, cardNumber }) {
  if (typeof buyerEmail !== 'string' || buyerEmail.length > 254 || !EMAIL_RE.test(buyerEmail)) return false;
  if (typeof cardNumber !== 'string' || !CARD_RE.test(cardNumber)) return false;
  return true;
}

export async function purchaseTicket({ eventId, userId = null, buyerEmail, cardNumber, channel }) {
  if (!CHANNELS.includes(channel)) throw new TypeError(`purchaseTicket: channel inválido (${channel})`);
  if (!validatePurchaseInput({ buyerEmail, cardNumber })) return { ok: false, error: 'invalid_request' };
  if (typeof eventId !== 'string' || !eventId) return { ok: false, error: 'event_not_available' };

  const result = await withTransaction(async (client) => {
    const event = await lockEvent(client, eventId);
    if (!event || event.status !== 'published') return { ok: false, error: 'event_not_available' };

    const occupied = await occupiedSeats(client, event.id);
    if (occupied >= event.capacity) return { ok: false, error: 'sold_out' };

    let ticket = null;
    for (let i = 0; i < MAX_CODE_ATTEMPTS && !ticket; i++) {
      ticket = await insertTicket(client, {
        id: newId('tkt'),
        eventId: event.id,
        userId,
        buyerEmail,
        code: generateTicketCode(),
        priceCents: event.price_cents, // preço vigente no momento da compra (R03, R12)
        channel,
      });
    }
    if (!ticket) throw new Error('purchaseTicket: não foi possível gerar código único');

    const { outcome, delayMs } = decide(cardNumber);
    const attempt = await insertPaymentAttempt(client, {
      id: newId('pay'),
      ticketId: ticket.id,
      cardLast4: cardNumber.slice(-4),
      outcome,
      delayMs,
    });
    return { ok: true, ticket, attempt };
  });

  if (result.ok) {
    for (const fn of committedListeners) {
      try {
        fn(result);
      } catch (err) {
        console.error('[purchase] ouvinte falhou:', err);
      }
    }
  }
  return result;
}
