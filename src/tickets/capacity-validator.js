import { registerEditValidator } from '../events/edit-validators.js';
import { occupiedSeats } from './availability.js';

// R03 (F03.P6): reduzir a lotação abaixo das vagas ocupadas (pendentes + confirmados) é rejeitado.
// Roda dentro da transação da edição de F02, com a linha do evento travada (FOR UPDATE) — serializa com compras.

export function capacityBelowOccupiedMessage(occupied) {
  return `A lotação não pode ser menor que as vagas ocupadas (${occupied})`;
}

export async function capacityValidator({ client, event, next }) {
  const occupied = await occupiedSeats(client, event.id);
  return next.capacity < occupied ? capacityBelowOccupiedMessage(occupied) : null;
}

registerEditValidator(capacityValidator);
