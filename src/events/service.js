import { withTransaction } from '../db/pool.js';
import { newId } from '../ids.js';
import { insertEvent, lockEvent, setEventPublished, updateEvent } from './repo.js';
import { parseEventInput } from './validation.js';
import { runEditValidators } from './edit-validators.js';

// Resultados: { ok: true, event } | { ok: false, status, errors?, message? }
//   status 422 → errors por campo (R01) e/ou message (validadores registrados)
//   status 409 → transição não permitida (evento cancelado, publicar fora de rascunho); event = linha atual
//   status 404 → evento sumiu

export const CANCELLED_EDIT_MESSAGE = 'Evento cancelado não pode ser editado';
export const PUBLISH_CONFLICT_MESSAGE = 'Só eventos em rascunho podem ser publicados';
export const CANCELLED_PUBLISH_MESSAGE = 'Evento cancelado não pode ser publicado';

// Cria o evento como rascunho (R02) depois de validar R01.
export async function createEvent(organizerId, input, now = new Date()) {
  const { value, errors } = parseEventInput(input, now);
  if (errors) return { ok: false, status: 422, errors };
  const event = await insertEvent({ id: newId('evt'), organizerId, ...value });
  return { ok: true, event };
}

// Edita todos os campos. Numa transação: trava a linha (FOR UPDATE — serializa com compras e cancelamento),
// recusa evento cancelado, valida R01 (data futura também na edição) e roda os validadores registrados.
export async function editEvent(event, input, now = new Date()) {
  return withTransaction(async (client) => {
    const current = await lockEvent(client, event.id);
    if (!current) return { ok: false, status: 404 };
    if (current.status === 'cancelled') return { ok: false, status: 409, message: CANCELLED_EDIT_MESSAGE, event: current };

    const { value, errors } = parseEventInput(input, now);
    if (errors) return { ok: false, status: 422, errors };

    const messages = await runEditValidators({ client, event: current, next: value });
    if (messages.length) return { ok: false, status: 422, errors: {}, message: messages.join(' ') };

    const updated = await updateEvent(current.id, value, client);
    return { ok: true, event: updated };
  });
}

// draft → published (R02). Qualquer outro status → 409.
export async function publishEvent(event) {
  return withTransaction(async (client) => {
    const current = await lockEvent(client, event.id);
    if (!current) return { ok: false, status: 404 };
    if (current.status !== 'draft') {
      const message = current.status === 'cancelled' ? CANCELLED_PUBLISH_MESSAGE : PUBLISH_CONFLICT_MESSAGE;
      return { ok: false, status: 409, message, event: current };
    }
    const updated = await setEventPublished(current.id, client);
    return { ok: true, event: updated };
  });
}
