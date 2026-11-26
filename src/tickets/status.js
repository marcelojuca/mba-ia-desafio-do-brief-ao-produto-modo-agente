// Rótulos (UI, pt-BR) dos status do ingresso. Valor da API → rótulo.
export const TICKET_STATUS_LABELS = Object.freeze({
  pending: 'pendente',
  confirmed: 'confirmado',
  declined: 'recusado',
  cancelled: 'cancelado',
  refunded: 'estornado',
});

export const TICKET_STATUSES = Object.freeze(Object.keys(TICKET_STATUS_LABELS));

// Status que ocupam vaga (R05).
export const SEAT_HOLDING_STATUSES = Object.freeze(['pending', 'confirmed']);

export function ticketStatusLabel(status) {
  return TICKET_STATUS_LABELS[status] || status;
}
