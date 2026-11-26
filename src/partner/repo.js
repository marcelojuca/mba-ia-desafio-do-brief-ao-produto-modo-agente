import { query } from '../db/pool.js';

// SQL da API de parceiros (F04).

// Ingresso de qualquer canal com o indicador de check-in, ou null.
// `checked_in_at` é criado por F05 (tickets.checked_in_at); `to_jsonb(t) ->> 'checked_in_at'` devolve null enquanto a
// coluna não existir, então a consulta funciona antes e depois da migração de F05 sem depender dela.
export async function getPartnerTicket(id) {
  const { rows } = await query(
    `select t.id, t.code, t.event_id, t.status,
            (to_jsonb(t) ->> 'checked_in_at') is not null as checked_in
       from tickets t
      where t.id = $1`,
    [id],
  );
  return rows[0] || null;
}
