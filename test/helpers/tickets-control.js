// Compras com resposta do gateway controlada pelo teste (F05+). Sem worker ligado: cada compra tem a resposta
// adiada (hold) e só settle(ticketId) a aplica, via processDueAttempts() de F03 — determinístico.
import assert from 'node:assert/strict';
import { query } from './db.js';
import { card } from './fixtures.js';
import { purchaseTicket } from '../../src/tickets/purchase.js';
import { processDueAttempts } from '../../src/gateway/worker.js';

export const holdGateway = (ticketId) =>
  query(`update payment_attempts set respond_at = now() + interval '1 hour' where ticket_id = $1`, [ticketId]);

// Aplica a resposta do gateway (aprovada/recusada pelo final do cartão) agora; devolve o novo status.
export async function settle(ticketId) {
  await query('update payment_attempts set respond_at = now() where ticket_id = $1', [ticketId]);
  await processDueAttempts();
  const { rows } = await query('select status from tickets where id = $1', [ticketId]);
  return rows[0].status;
}

// Compra na vitrine (canal web) com o cliente HTTP de um participante logado.
export async function buyWeb(participant, eventId, last4 = '0001') {
  const r = await participant.postForm(`/events/${eventId}/purchase`, { cardNumber: card(last4) });
  assert.equal(r.status, 303, r.text);
  const { rows } = await query(
    `select * from tickets where event_id = $1 and channel = 'web' order by created_at desc, id desc limit 1`,
    [eventId],
  );
  await holdGateway(rows[0].id);
  return rows[0];
}

// Compra pelo serviço de F03 com channel 'partner' (mesmo caminho da API de F04).
export async function buyPartner(eventId, last4 = '0004') {
  const r = await purchaseTicket({ eventId, buyerEmail: 'cliente@parceiro.com', cardNumber: card(last4), channel: 'partner' });
  assert.ok(r.ok, JSON.stringify(r));
  await holdGateway(r.ticket.id);
  return r.ticket;
}
