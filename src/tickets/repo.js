import { query } from '../db/pool.js';

// Acesso SQL das tabelas tickets/payment_attempts. Funções que recebem `client` rodam dentro de withTransaction.

// Ingresso por id (qualquer canal) ou null.
export async function getTicketById(id, client = null) {
  const runner = client || { query };
  const { rows } = await runner.query('select * from tickets where id = $1', [id]);
  return rows[0] || null;
}

// Ingressos do participante, com nome e data do evento (mais recentes primeiro).
export async function listTicketsByUser(userId) {
  const { rows } = await query(
    `select t.*, e.name as event_name, e.starts_at as event_starts_at
       from tickets t
       join events e on e.id = t.event_id
      where t.user_id = $1
      order by t.created_at desc, t.id`,
    [userId],
  );
  return rows;
}

// Insere o ingresso; retorna a linha ou null se o código colidiu (ON CONFLICT (code) DO NOTHING).
export async function insertTicket(client, { id, eventId, userId, buyerEmail, code, priceCents, channel }) {
  const { rows } = await client.query(
    `insert into tickets (id, event_id, user_id, buyer_email, code, price_cents, channel)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (code) do nothing
     returning *`,
    [id, eventId, userId, buyerEmail, code, priceCents, channel],
  );
  return rows[0] || null;
}

export async function insertPaymentAttempt(client, { id, ticketId, cardLast4, outcome, delayMs }) {
  const { rows } = await client.query(
    `insert into payment_attempts (id, ticket_id, card_last4, outcome, respond_at)
     values ($1, $2, $3, $4, now() + ($5::double precision * interval '1 millisecond'))
     returning *`,
    [id, ticketId, cardLast4, outcome, delayMs],
  );
  return rows[0];
}
