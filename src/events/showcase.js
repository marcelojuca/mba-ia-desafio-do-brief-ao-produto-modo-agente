import { Router } from 'express';
import { html, formatBRL, formatDateTime } from '../web/html.js';
import { render } from '../web/layout.js';
import { listOnSaleEvents } from './repo.js';
import { getAvailabilityForEvents } from '../tickets/availability.js';
import { renderPurchaseBlock } from '../tickets/showcase-card.js';

// Vitrine pública (R02): só eventos published, ordenados pelo início.
// F03 acrescenta vagas disponíveis e o bloco de compra (src/tickets/showcase-card.js).
export const showcaseRouter = Router();

// Cartão de um evento na vitrine. extra = conteúdo adicional (SafeHtml), ex.: bloco de compra de F03.
export function renderShowcaseEvent(event, extra = '') {
  return html`<article class="event" data-event-id="${event.id}">
    <h2>${event.name}</h2>
    <p>
      <span data-event-starts-at>${formatDateTime(event.starts_at)}</span> ·
      <span data-event-venue>${event.venue}</span>
    </p>
    <p><strong data-event-price>${formatBRL(event.price_cents)}</strong></p>
    ${extra}
  </article>`;
}

// Página da vitrine. Também usada para respostas de erro da compra (ex.: 409 "Ingressos esgotados").
export async function renderShowcasePage(req, res, { status = 200, notice = null, error = null } = {}) {
  const events = await listOnSaleEvents();
  const availability = await getAvailabilityForEvents(events);
  const user = req.user || null;
  render(res, {
    status,
    notice,
    error,
    title: 'Eventos à venda',
    body: events.length
      ? html`<div data-showcase>${events.map((e) =>
          renderShowcaseEvent(e, renderPurchaseBlock(e, availability.get(e.id), user)),
        )}</div>`
      : html`<p data-showcase-empty>Nenhum evento à venda no momento</p>`,
  });
}

showcaseRouter.get('/', async (req, res, next) => {
  try {
    await renderShowcasePage(req, res);
  } catch (err) {
    next(err);
  }
});
