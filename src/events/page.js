import { html, raw, formatBRL, formatDateTime, toDateTimeLocal } from '../web/html.js';
import { render } from '../web/layout.js';
import { readFlash } from '../web/flash.js';
import { listManagementSections } from './management-sections.js';

export const EVENT_STATUS_LABELS = Object.freeze({
  draft: 'Rascunho',
  published: 'Publicado',
  cancelled: 'Cancelado',
});

export function eventStatusLabel(status) {
  return EVENT_STATUS_LABELS[status] || status;
}

// 10000 → "100,00" (valor do campo de preço)
export function centsToPriceInput(cents) {
  return formatBRL(cents).replace(/^-?R\$\s*/, '');
}

function fieldError(errors, name) {
  return errors?.[name] ? html`<p class="field-error" data-field-error="${name}">${errors[name]}</p>` : '';
}

// Campos do formulário de evento (criação e edição). values = strings do formulário.
export function eventFormFields(values = {}, errors = {}) {
  return html`
    <label for="name">Nome</label>
    <input id="name" name="name" required maxlength="200" value="${values.name ?? ''}">
    ${fieldError(errors, 'name')}
    <label for="startsAt">Início (horário de Brasília)</label>
    <input id="startsAt" name="startsAt" type="datetime-local" required value="${values.startsAt ?? ''}">
    ${fieldError(errors, 'startsAt')}
    <label for="venue">Local</label>
    <input id="venue" name="venue" required maxlength="200" value="${values.venue ?? ''}">
    ${fieldError(errors, 'venue')}
    <label for="capacity">Lotação</label>
    <input id="capacity" name="capacity" type="number" min="1" step="1" required value="${values.capacity ?? ''}">
    ${fieldError(errors, 'capacity')}
    <label for="price">Preço (R$)</label>
    <input id="price" name="price" inputmode="decimal" required placeholder="100,00" value="${values.price ?? ''}">
    ${fieldError(errors, 'price')}`;
}

function valuesFromEvent(event) {
  return {
    name: event.name,
    startsAt: toDateTimeLocal(event.starts_at),
    venue: event.venue,
    capacity: String(event.capacity),
    price: centsToPriceInput(event.price_cents),
  };
}

function pickFormValues(body = {}) {
  const out = {};
  for (const k of ['name', 'startsAt', 'venue', 'capacity', 'price']) {
    out[k] = typeof body[k] === 'string' ? body[k] : '';
  }
  return out;
}

// Página de gestão de req.event (R04). Usada pelas rotas de F02 e reaproveitada por F05/F06 para mostrar o
// resultado de ações: renderManagementPage(req, res, { status, notice, error, errors, values }).
// - notice: aviso (em <p data-notice>); sem notice, mostra a mensagem flash pendente;
// - error: mensagem geral de erro (em <p data-error>);
// - errors/values: erros por campo e valores digitados no formulário de edição (re-renderização 422).
export async function renderManagementPage(req, res, { status = 200, notice = null, error = null, errors = {}, values = null } = {}) {
  const event = req.event;
  const shownNotice = notice ?? readFlash(req, res);
  const cancelled = event.status === 'cancelled';
  const formValues = values ? pickFormValues(values) : valuesFromEvent(event);

  const sectionsHtml = [];
  for (const section of listManagementSections()) {
    const out = await section.render({ event, req, flash: shownNotice });
    // string = HTML já pronto (gerado pela própria seção); prefira html`` para escapar dados.
    const content = typeof out === 'string' ? raw(out) : out;
    if (out) sectionsHtml.push(html`<section data-section="${section.id}">${content}</section>`);
  }

  render(res, {
    status,
    title: event.name,
    notice: shownNotice,
    error,
    body: html`
      <p><a href="/organizer">← Meus eventos</a></p>
      <section data-section="details">
        <dl data-event-id="${event.id}">
          <dt>Status</dt><dd data-event-status="${event.status}">${eventStatusLabel(event.status)}</dd>
          <dt>Início</dt><dd data-event-starts-at>${formatDateTime(event.starts_at)}</dd>
          <dt>Local</dt><dd data-event-venue>${event.venue}</dd>
          <dt>Lotação</dt><dd data-event-capacity>${event.capacity}</dd>
          <dt>Preço</dt><dd data-event-price>${formatBRL(event.price_cents)}</dd>
        </dl>
        ${event.status === 'draft'
          ? html`<form method="post" action="/organizer/events/${event.id}/publish" data-form="publish">
              <button type="submit">Publicar</button>
              <small>Enquanto for rascunho, o evento não aparece na vitrine.</small>
            </form>`
          : ''}
        ${cancelled ? html`<p data-event-locked>Evento cancelado: não pode ser editado nem publicado.</p>` : ''}
      </section>
      ${cancelled
        ? ''
        : html`<section data-section="edit">
            <h2>Editar evento</h2>
            <form class="stack" method="post" action="/organizer/events/${event.id}" data-form="edit-event">
              ${eventFormFields(formValues, errors)}
              <button type="submit">Salvar alterações</button>
            </form>
          </section>`}
      ${sectionsHtml}`,
  });
}
