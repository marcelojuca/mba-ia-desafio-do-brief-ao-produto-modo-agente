import { query } from '../db/pool.js';

// Acesso SQL da tabela events. Funções que recebem `client` rodam dentro de withTransaction.

export async function insertEvent({ id, organizerId, name, startsAt, venue, capacity, priceCents }) {
  const { rows } = await query(
    `insert into events (id, organizer_id, name, starts_at, venue, capacity, price_cents)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning *`,
    [id, organizerId, name, startsAt, venue, capacity, priceCents],
  );
  return rows[0];
}

// Atualiza os campos editáveis. `client` opcional (transação da edição).
export async function updateEvent(id, { name, startsAt, venue, capacity, priceCents }, client = null) {
  const runner = client || { query };
  const { rows } = await runner.query(
    `update events
        set name = $2, starts_at = $3, venue = $4, capacity = $5, price_cents = $6, updated_at = now()
      where id = $1
      returning *`,
    [id, name, startsAt, venue, capacity, priceCents],
  );
  return rows[0] || null;
}

// Só draft → published. Retorna a linha atualizada ou null se o status não era draft.
export async function setEventPublished(id) {
  const { rows } = await query(
    `update events set status = 'published', updated_at = now()
      where id = $1 and status = 'draft'
      returning *`,
    [id],
  );
  return rows[0] || null;
}

export async function findEventById(id) {
  const { rows } = await query('select * from events where id = $1', [id]);
  return rows[0] || null;
}

// Busca por id E dono (R13): evento de outro organizador → null, igual a inexistente.
export async function findOwnedEvent(id, organizerId) {
  const { rows } = await query('select * from events where id = $1 and organizer_id = $2', [id, organizerId]);
  return rows[0] || null;
}

export async function listEventsByOrganizer(organizerId) {
  const { rows } = await query(
    'select * from events where organizer_id = $1 order by starts_at, created_at',
    [organizerId],
  );
  return rows;
}

// Eventos à venda (vitrine e API de parceiros): só published, ordenados pelo início.
export async function listOnSaleEvents() {
  const { rows } = await query(
    "select * from events where status = 'published' order by starts_at, created_at",
  );
  return rows;
}

// Lock exclusivo da linha do evento (dentro de withTransaction). Retorna a linha ou null.
export async function lockEvent(client, id) {
  const { rows } = await client.query('select * from events where id = $1 for update', [id]);
  return rows[0] || null;
}
