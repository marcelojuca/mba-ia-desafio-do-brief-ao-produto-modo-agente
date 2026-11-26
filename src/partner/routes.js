import express from 'express';
import { listOnSaleEvents } from '../events/repo.js';
import { getAvailabilityForEvents } from '../tickets/availability.js';
import { purchaseTicket } from '../tickets/purchase.js';
import { formatIsoBrt } from '../web/html.js';
import { requireApiKey } from './auth.js';
import { getPartnerTicket } from './repo.js';

// API de parceiros (F04) — contrato fixo do brief. Montada em /api/partner por src/app.js.
// Ordem: X-Api-Key (401) antes de qualquer outra coisa, inclusive do parse do corpo e de rotas inexistentes.

const PURCHASE_ERROR_STATUS = Object.freeze({ invalid_request: 422, event_not_available: 404, sold_out: 409 });

const routes = express.Router();

// GET /api/partner/events → eventos publicados com vagas disponíveis (R05).
routes.get('/events', async (_req, res, next) => {
  try {
    const events = await listOnSaleEvents();
    const availability = await getAvailabilityForEvents(events);
    res.json(
      events.map((e) => ({
        id: e.id,
        name: e.name,
        startsAt: formatIsoBrt(e.starts_at),
        priceCents: e.price_cents,
        availableSeats: availability.get(e.id).available,
      })),
    );
  } catch (err) {
    next(err);
  }
});

// POST /api/partner/events/:eventId/purchases → 202 pending | 422 | 404 | 409 (mesma purchaseTicket da vitrine, R07).
routes.post('/events/:eventId/purchases', async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const result = await purchaseTicket({
      eventId: req.params.eventId,
      userId: null,
      buyerEmail: body.buyerEmail,
      cardNumber: body.cardNumber,
      channel: 'partner',
    });
    if (!result.ok) return res.status(PURCHASE_ERROR_STATUS[result.error] || 500).json({ error: result.error });
    const { ticket } = result;
    res.status(202).json({ ticketId: ticket.id, code: ticket.code, status: ticket.status });
  } catch (err) {
    next(err);
  }
});

// GET /api/partner/tickets/:ticketId → ingresso de qualquer canal.
routes.get('/tickets/:ticketId', async (req, res, next) => {
  try {
    const t = await getPartnerTicket(req.params.ticketId);
    if (!t) return res.status(404).json({ error: 'ticket_not_found' });
    res.json({ ticketId: t.id, code: t.code, eventId: t.event_id, status: t.status, checkedIn: t.checked_in });
  } catch (err) {
    next(err);
  }
});

export const partnerRouter = express.Router();
partnerRouter.use(requireApiKey);
partnerRouter.use(express.json({ limit: '100kb' }));
partnerRouter.use(routes);
partnerRouter.use((_req, res) => res.status(404).json({ error: 'not_found' }));
// eslint-disable-next-line no-unused-vars
partnerRouter.use((err, _req, res, _next) => {
  // Corpo ilegível (JSON malformado, charset/tamanho inválido) → 422 invalid_request.
  if (err?.type === 'entity.parse.failed' || (err?.status >= 400 && err?.status < 500)) {
    return res.status(422).json({ error: 'invalid_request' });
  }
  console.error('[partner] erro não tratado:', err);
  if (res.headersSent) return res.end();
  res.status(500).json({ error: 'internal_error' });
});
