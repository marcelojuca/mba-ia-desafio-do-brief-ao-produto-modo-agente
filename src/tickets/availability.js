import { pool } from '../db/pool.js';
import { SEAT_HOLDING_STATUSES } from './status.js';

// Vagas (R05): disponíveis = lotação − (pendentes + confirmados); evento cancelado → 0; nunca negativo.

// Vagas ocupadas (pending + confirmed). `client` = conexão (transação) ou pool.
export async function occupiedSeats(client, eventId) {
  const { rows } = await (client || pool).query(
    `select count(*)::int as n from tickets where event_id = $1 and status = any($2::text[])`,
    [eventId, SEAT_HOLDING_STATUSES],
  );
  return rows[0].n;
}

// Cálculo puro a partir da linha do evento e das vagas ocupadas.
export function computeAvailability(event, occupied) {
  const capacity = Number(event.capacity);
  const available = event.status === 'cancelled' ? 0 : Math.max(0, capacity - occupied);
  return { capacity, occupied, available };
}

// getAvailability(eventId, client?) → { capacity, occupied, available } ou null se o evento não existe.
export async function getAvailability(eventId, client = null) {
  const runner = client || pool;
  const { rows } = await runner.query(
    `select e.capacity, e.status,
            (select count(*)::int from tickets t
              where t.event_id = e.id and t.status = any($2::text[])) as occupied
       from events e where e.id = $1`,
    [eventId, SEAT_HOLDING_STATUSES],
  );
  if (!rows[0]) return null;
  return computeAvailability(rows[0], rows[0].occupied);
}

// Disponibilidade de vários eventos (linhas de events) numa consulta só → Map(eventId → { capacity, occupied, available }).
export async function getAvailabilityForEvents(events) {
  const map = new Map();
  if (!events.length) return map;
  const { rows } = await pool.query(
    `select event_id, count(*)::int as n from tickets
      where event_id = any($1::text[]) and status = any($2::text[])
      group by event_id`,
    [events.map((e) => e.id), SEAT_HOLDING_STATUSES],
  );
  const occupied = new Map(rows.map((r) => [r.event_id, r.n]));
  for (const e of events) map.set(e.id, computeAvailability(e, occupied.get(e.id) || 0));
  return map;
}
