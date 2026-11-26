import { query } from '../db/pool.js';
import { getAvailability } from '../tickets/availability.js';

// Números do painel do evento (F05.P2, R12). Lê todos os ingressos do evento, então conta os dois canais
// (web e partner). Receita = soma de tickets.price_cents (preço do momento da compra) dos confirmados;
// estornados ficam fora da receita e contam em "Estornados".
export async function getPanelMetrics(eventId) {
  const { rows } = await query(
    `select
       count(*) filter (where status = 'confirmed')                               as confirmed,
       count(*) filter (where status = 'pending')                                 as pending,
       count(*) filter (where status = 'confirmed' and checked_in_at is not null) as checkins,
       coalesce(sum(price_cents) filter (where status = 'confirmed'), 0)          as revenue_cents,
       count(*) filter (where status = 'refunded')                                as refunded
     from tickets where event_id = $1`,
    [eventId],
  );
  const availability = await getAvailability(eventId);
  const m = rows[0];
  return {
    confirmed: Number(m.confirmed),
    pending: Number(m.pending),
    checkins: Number(m.checkins),
    available: availability ? availability.available : 0,
    revenueCents: Number(m.revenue_cents),
    refunded: Number(m.refunded),
  };
}
