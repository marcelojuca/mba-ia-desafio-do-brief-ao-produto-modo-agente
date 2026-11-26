import { withTransaction } from '../db/pool.js';

// Check-in (F05.P1, R10). Mensagens exatas por chave (data-checkin-result).
export const CHECKIN_MESSAGES = Object.freeze({
  invalid: 'Ingresso inválido para este evento',
  event_cancelled: 'Evento cancelado',
  not_confirmed: 'Ingresso não confirmado',
  already_used: 'Ingresso já utilizado',
  ok: 'Entrada liberada',
});

// Código digitado → forma canônica (trim + maiúsculas).
export function normalizeCode(raw) {
  return typeof raw === 'string' ? raw.trim().toUpperCase() : '';
}

const result = (key) => ({ key, message: CHECKIN_MESSAGES[key] });

// checkIn(eventId, rawCode) → { key, message }.
// Numa transação: evento FOR SHARE (serializa com o cancelamento de F06, que usa FOR UPDATE) e ingresso
// FOR UPDATE (dois check-ins simultâneos do mesmo código liberam a entrada uma única vez). A primeira
// situação verdadeira, na ordem de R10, define o resultado.
export async function checkIn(eventId, rawCode) {
  const code = normalizeCode(rawCode);
  return withTransaction(async (client) => {
    const { rows: events } = await client.query('select status from events where id = $1 for share', [eventId]);
    const event = events[0];
    if (!event || !code) return result('invalid');

    const { rows: tickets } = await client.query(
      'select id, status, checked_in_at from tickets where code = $1 and event_id = $2 for update',
      [code, eventId],
    );
    const ticket = tickets[0];
    if (!ticket) return result('invalid');
    if (event.status === 'cancelled') return result('event_cancelled');
    if (ticket.status !== 'confirmed') return result('not_confirmed');
    if (ticket.checked_in_at) return result('already_used');

    await client.query('update tickets set checked_in_at = now(), updated_at = now() where id = $1', [ticket.id]);
    return result('ok');
  });
}
