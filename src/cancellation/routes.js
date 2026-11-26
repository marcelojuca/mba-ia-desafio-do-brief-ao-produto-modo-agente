import { Router } from 'express';
import { html, formatDateTime } from '../web/html.js';
import { setFlash } from '../web/flash.js';
import { requireRole } from '../auth/middleware.js';
import { loadOwnedEvent, renderEventNotFound } from '../events/guard.js';
import { renderManagementPage } from '../events/page.js';
import { registerManagementSection } from '../events/management-sections.js';
import { cancelEvent, notCancellableMessage } from './service.js';

// Cancelamento de evento (F06.P1): seção na página de gestão (F02) + POST /organizer/events/:id/cancel.
// Visitante → 302 /login; participante → 403; evento de outro organizador → 404 (loadOwnedEvent, R13).
export const cancellationRouter = Router();

export const CANCELLED_NOTICE = 'Evento cancelado';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

registerManagementSection({
  id: 'cancel',
  order: 90,
  render: ({ event }) => {
    if (event.status === 'published') {
      return html`<h2>Cancelar evento</h2>
        <form method="post" action="/organizer/events/${event.id}/cancel" data-form="cancel-event">
          <p data-cancel-warning><strong>Atenção:</strong> o cancelamento é irreversível. O evento sai da vitrine e
            deixa de vender; ingressos confirmados são estornados e pendentes, cancelados.</p>
          <button type="submit" data-action="cancel-event">Cancelar evento</button>
        </form>`;
    }
    if (event.status === 'cancelled') {
      return html`<p data-event-cancelled-at>${event.cancelled_at
        ? html`Evento cancelado em ${formatDateTime(event.cancelled_at)}`
        : 'Evento cancelado'}</p>`;
    }
    return null; // rascunho: não há o que cancelar
  },
});

cancellationRouter.post(
  '/organizer/events/:id/cancel',
  requireRole('organizer'),
  loadOwnedEvent,
  wrap(async (req, res) => {
    const result = await cancelEvent(req.event.id, req.user.id);
    if (result.ok) {
      setFlash(res, CANCELLED_NOTICE);
      return res.redirect(303, `/organizer/events/${req.event.id}`);
    }
    if (result.error === 'not_found') return renderEventNotFound(res);
    req.event = result.event;
    return renderManagementPage(req, res, { status: 409, error: notCancellableMessage(result.event) });
  }),
);
