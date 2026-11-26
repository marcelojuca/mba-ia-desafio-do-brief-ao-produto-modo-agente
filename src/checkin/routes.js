import { Router } from 'express';
import { loadOwnedEvent } from '../events/guard.js';
import { renderManagementPage } from '../events/page.js';
import { checkIn } from './service.js';
import './section.js'; // registra a seção 'checkin' na página de gestão

// POST /organizer/events/:id/checkin (F05.P1). loadOwnedEvent: visitante → /login, participante → 403,
// evento de outro organizador → 404 sem dados e sem executar o check-in (R13).
export const checkinRouter = Router();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

checkinRouter.post(
  '/organizer/events/:id/checkin',
  loadOwnedEvent,
  wrap(async (req, res) => {
    req.checkinResult = await checkIn(req.event.id, req.body?.code);
    return renderManagementPage(req, res, { status: 200 });
  }),
);
