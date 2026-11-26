import { withTransaction } from '../db/pool.js';

// Cancelamento de evento (F06.P2, R11).
//
//   cancelEvent(eventId, organizerId)
//     → { ok: true, event, refunded, cancelled }
//     | { ok: false, error: 'not_found' }                 (inexistente ou de outro organizador, R13)
//     | { ok: false, error: 'not_cancellable', event }    (rascunho ou já cancelado)
//
// Numa única transação:
// 1. trava a linha do evento (FOR UPDATE) — o mesmo lock da compra (F03) e da edição/publicação (F02), então nenhuma
//    compra entra depois do cancelamento;
// 2. só 'published' cancela; status → 'cancelled', cancelled_at = now();
// 3. UMA instrução para os ingressos, com CASE: confirmed → refunded, pending → cancelled. Em READ COMMITTED, se o
//    worker do gateway estiver confirmando um pendente ao mesmo tempo, o UPDATE espera o lock da linha, reavalia com
//    o valor novo e o CASE escolhe o destino certo. Duas instruções separadas deixariam uma janela em que um pendente
//    vira confirmado depois do passo "confirmados → estornados" e escapa.
// Resposta tardia do gateway: o worker só altera ingressos 'pending' (F03); depois daqui não sobra nenhum.

export const NOT_CANCELLABLE_MESSAGE = 'Só eventos publicados podem ser cancelados';
export const ALREADY_CANCELLED_MESSAGE = 'Evento já está cancelado';

export function notCancellableMessage(event) {
  return event?.status === 'cancelled' ? ALREADY_CANCELLED_MESSAGE : NOT_CANCELLABLE_MESSAGE;
}

export async function cancelEvent(eventId, organizerId) {
  return withTransaction(async (client) => {
    const { rows } = await client.query('select * from events where id = $1 and organizer_id = $2 for update', [
      eventId,
      organizerId,
    ]);
    const current = rows[0];
    if (!current) return { ok: false, error: 'not_found' };
    if (current.status !== 'published') return { ok: false, error: 'not_cancellable', event: current };

    const updated = await client.query(
      `update events
          set status = 'cancelled', cancelled_at = now(), updated_at = now()
        where id = $1
        returning *`,
      [current.id],
    );

    const tickets = await client.query(
      `update tickets
          set status = case status when 'confirmed' then 'refunded' else 'cancelled' end,
              updated_at = now()
        where event_id = $1 and status in ('pending', 'confirmed')
        returning status`,
      [current.id],
    );
    const refunded = tickets.rows.filter((t) => t.status === 'refunded').length;
    return { ok: true, event: updated.rows[0], refunded, cancelled: tickets.rows.length - refunded };
  });
}
