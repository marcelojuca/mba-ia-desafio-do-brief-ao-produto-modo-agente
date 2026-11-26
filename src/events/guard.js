import { requireRole } from '../auth/middleware.js';
import { renderError } from '../web/layout.js';
import { findOwnedEvent } from './repo.js';

const requireOrganizer = requireRole('organizer');

// Resposta única para "não existe" e "é de outro organizador" (R13): nenhum dado do evento.
export function renderEventNotFound(res) {
  renderError(res, 404, 'Evento não encontrado', 'O evento não existe ou não pertence à sua conta.');
}

// Middleware para rotas /organizer/events/:id[/...]:
// visitante → 302 /login; participante → 403; evento inexistente ou de outro organizador → 404.
// Coloca o evento em req.event. Pode ser usado sozinho ou depois de requireRole('organizer').
export function loadOwnedEvent(req, res, next) {
  requireOrganizer(req, res, async () => {
    try {
      const event = await findOwnedEvent(String(req.params.id ?? ''), req.user.id);
      if (!event) return renderEventNotFound(res);
      req.event = event;
      next();
    } catch (err) {
      next(err);
    }
  });
}
