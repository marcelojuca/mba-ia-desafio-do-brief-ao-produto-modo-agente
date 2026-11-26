import { Router } from 'express';
import { html, formatDateTime } from '../web/html.js';
import { render, renderError } from '../web/layout.js';
import { setFlash } from '../web/flash.js';
import { requireRole } from '../auth/middleware.js';
import { renderShowcasePage } from '../events/showcase.js';
import { purchaseTicket } from './purchase.js';
import { listTicketsByUser } from './repo.js';
import { ticketStatusLabel } from './status.js';

// Compra na vitrine e "Meus ingressos" (F03.P5). Só participantes (visitante → /login; organizador → 403).
export const ticketsRouter = Router();

export const MESSAGES = Object.freeze({
  purchased: 'Compra recebida, aguardando pagamento',
  soldOut: 'Ingressos esgotados',
  invalidCard: 'O número do cartão deve ter 16 dígitos',
  unavailable: 'Evento indisponível',
});

const requireParticipant = requireRole('participant');
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

ticketsRouter.post(
  '/events/:id/purchase',
  requireParticipant,
  wrap(async (req, res) => {
    const raw = req.body?.cardNumber;
    const cardNumber = typeof raw === 'string' ? raw.trim() : raw;
    const result = await purchaseTicket({
      eventId: String(req.params.id),
      userId: req.user.id,
      buyerEmail: req.user.email,
      cardNumber,
      channel: 'web',
    });
    if (result.ok) {
      setFlash(res, MESSAGES.purchased);
      return res.redirect(303, '/my-tickets');
    }
    switch (result.error) {
      case 'sold_out':
        return renderShowcasePage(req, res, { status: 409, error: MESSAGES.soldOut });
      case 'invalid_request':
        return renderShowcasePage(req, res, { status: 422, error: MESSAGES.invalidCard });
      default:
        return renderError(res, 404, MESSAGES.unavailable, 'Este evento não está disponível para compra.');
    }
  }),
);

ticketsRouter.get(
  '/my-tickets',
  requireParticipant,
  wrap(async (req, res) => {
    const tickets = await listTicketsByUser(req.user.id);
    render(res, {
      title: 'Meus ingressos',
      body: tickets.length
        ? html`<table data-my-tickets>
            <thead><tr><th>Evento</th><th>Data</th><th>Status</th><th>Código</th></tr></thead>
            <tbody>
              ${tickets.map(
                (t) => html`<tr data-ticket-code="${t.code}" data-ticket-status="${t.status}" data-event-id="${t.event_id}">
                  <td>${t.event_name}</td>
                  <td>${formatDateTime(t.event_starts_at)}</td>
                  <td>${ticketStatusLabel(t.status)}</td>
                  <td><code>${t.code}</code></td>
                </tr>`,
              )}
            </tbody>
          </table>
          <p><small>Pagamentos pendentes são atualizados em segundos; recarregue a página.</small></p>`
        : html`<p data-empty>Você ainda não tem ingressos</p>`,
    });
  }),
);
