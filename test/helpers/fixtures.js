// Fixtures de banco para testes de F03+ (eventos e participantes direto no banco).
import { query } from './db.js';
import { newId } from '../../src/ids.js';
import { SEED } from './client.js';

const DAY = 24 * 60 * 60 * 1000;

export async function userIdByEmail(email) {
  const { rows } = await query('select id from users where email = $1', [email]);
  if (!rows[0]) throw new Error(`usuário ${email} não existe`);
  return rows[0].id;
}

// Cria um evento direto no banco (padrão: publicado, lotação 5, R$ 100,00, do organizador A, mês seguinte).
export async function createEventRow({
  organizerEmail = SEED.orgA,
  name = 'Evento teste',
  capacity = 5,
  priceCents = 10000,
  status = 'published',
  startsAt = new Date(Date.now() + 31 * DAY),
} = {}) {
  const organizerId = await userIdByEmail(organizerEmail);
  const { rows } = await query(
    `insert into events (id, organizer_id, name, starts_at, venue, capacity, price_cents, status)
     values ($1, $2, $3, $4, 'Bar do Zé', $5, $6, $7) returning *`,
    [newId('evt'), organizerId, name, startsAt, capacity, priceCents, status],
  );
  return rows[0];
}

export async function ticketsOf(eventId) {
  const { rows } = await query('select * from tickets where event_id = $1 order by created_at, id', [eventId]);
  return rows;
}

export async function countTickets(eventId = null) {
  const { rows } = eventId
    ? await query('select count(*)::int as n from tickets where event_id = $1', [eventId])
    : await query('select count(*)::int as n from tickets');
  return rows[0].n;
}

export const card = (last4) => `400000000000${last4}`;
