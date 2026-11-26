import { Router } from 'express';
import { html, formatBRL, formatDateTime } from '../web/html.js';
import { render } from '../web/layout.js';
import { listOnSaleEvents } from './repo.js';

// Vitrine pública (R02): só eventos published, ordenados pelo início.
export const showcaseRouter = Router();

// Cartão de um evento na vitrine. F03 estende com vagas e formulário de compra.
export function renderShowcaseEvent(event) {
  return html`<article class="event" data-event-id="${event.id}">
    <h2>${event.name}</h2>
    <p>
      <span data-event-starts-at>${formatDateTime(event.starts_at)}</span> ·
      <span data-event-venue>${event.venue}</span>
    </p>
    <p><strong data-event-price>${formatBRL(event.price_cents)}</strong></p>
  </article>`;
}

showcaseRouter.get('/', async (req, res, next) => {
  try {
    const events = await listOnSaleEvents();
    render(res, {
      title: 'Eventos à venda',
      body: events.length
        ? html`<div data-showcase>${events.map((e) => renderShowcaseEvent(e))}</div>`
        : html`<p data-showcase-empty>Nenhum evento à venda no momento</p>`,
    });
  } catch (err) {
    next(err);
  }
});
