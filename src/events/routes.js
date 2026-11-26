import { Router } from 'express';
import { html, formatDateTime } from '../web/html.js';
import { render } from '../web/layout.js';
import { setFlash } from '../web/flash.js';
import { requireRole } from '../auth/middleware.js';
import { listEventsByOrganizer } from './repo.js';
import { createEvent, editEvent, publishEvent, CANCELLED_EDIT_MESSAGE } from './service.js';
import { loadOwnedEvent, renderEventNotFound } from './guard.js';
import { eventFormFields, eventStatusLabel, renderManagementPage } from './page.js';

// Área do organizador (R04, R13). Toda rota /organizer* exige papel de organizador;
// as de /organizer/events/:id passam por loadOwnedEvent (evento de outro → 404 sem dados).
export const organizerRouter = Router();

organizerRouter.use('/organizer', requireRole('organizer'));

const FORM_ERROR = 'Corrija os campos destacados';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

organizerRouter.get(
  '/organizer',
  wrap(async (req, res) => {
    const events = await listEventsByOrganizer(req.user.id);
    render(res, {
      title: 'Meus eventos',
      body: html`
        <p><a href="/organizer/events/new" data-action="new-event">Novo evento</a></p>
        ${events.length
          ? html`<table data-organizer-events>
              <thead><tr><th>Nome</th><th>Data</th><th>Status</th><th></th></tr></thead>
              <tbody>
                ${events.map(
                  (e) => html`<tr data-event-id="${e.id}" data-event-status="${e.status}">
                    <td>${e.name}</td>
                    <td>${formatDateTime(e.starts_at)}</td>
                    <td>${eventStatusLabel(e.status)}</td>
                    <td><a href="/organizer/events/${e.id}">Gerenciar</a></td>
                  </tr>`,
                )}
              </tbody>
            </table>`
          : html`<p data-empty>Você ainda não criou eventos.</p>`}`,
    });
  }),
);

function newEventPage(res, { status = 200, values = {}, errors = {}, error = null } = {}) {
  render(res, {
    status,
    title: 'Novo evento',
    error,
    body: html`
      <p><a href="/organizer">← Meus eventos</a></p>
      <form class="stack" method="post" action="/organizer/events" data-form="new-event">
        ${eventFormFields(values, errors)}
        <button type="submit">Criar evento</button>
      </form>
      <p><small>O evento nasce como rascunho e só aparece na vitrine depois de publicado.</small></p>`,
  });
}

organizerRouter.get('/organizer/events/new', (req, res) => newEventPage(res));

organizerRouter.post(
  '/organizer/events',
  wrap(async (req, res) => {
    const body = req.body || {};
    const result = await createEvent(req.user.id, body);
    if (!result.ok) {
      return newEventPage(res, { status: 422, values: body, errors: result.errors, error: FORM_ERROR });
    }
    setFlash(res, 'Evento criado como rascunho');
    res.redirect(302, `/organizer/events/${result.event.id}`);
  }),
);

organizerRouter.get(
  '/organizer/events/:id',
  loadOwnedEvent,
  wrap((req, res) => renderManagementPage(req, res)),
);

organizerRouter.post(
  '/organizer/events/:id',
  loadOwnedEvent,
  wrap(async (req, res) => {
    if (req.event.status === 'cancelled') {
      return renderManagementPage(req, res, { status: 409, error: CANCELLED_EDIT_MESSAGE });
    }
    const body = req.body || {};
    const result = await editEvent(req.event, body);
    if (result.ok) {
      setFlash(res, 'Evento atualizado');
      return res.redirect(303, `/organizer/events/${req.event.id}`);
    }
    if (result.status === 404) return renderEventNotFound(res);
    if (result.status === 409) {
      req.event = result.event;
      return renderManagementPage(req, res, { status: 409, error: result.message });
    }
    return renderManagementPage(req, res, {
      status: 422,
      error: result.message || FORM_ERROR,
      errors: result.errors,
      values: body,
    });
  }),
);

organizerRouter.post(
  '/organizer/events/:id/publish',
  loadOwnedEvent,
  wrap(async (req, res) => {
    const result = await publishEvent(req.event);
    if (result.ok) {
      setFlash(res, 'Evento publicado');
      return res.redirect(303, `/organizer/events/${req.event.id}`);
    }
    if (result.status === 404) return renderEventNotFound(res);
    req.event = result.event;
    return renderManagementPage(req, res, { status: 409, error: result.message });
  }),
);
