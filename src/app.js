import express from 'express';
import { query } from './db/pool.js';
import { cookieParser } from './web/cookies.js';
import { html } from './web/html.js';
import { render, renderError } from './web/layout.js';
import { homeRouter } from './web/home.js';
import { loadSession } from './auth/sessions.js';
import { authRouter } from './auth/routes.js';
import { organizerRouter } from './events/routes.js';

// createApp(): registro central da aplicação. Toda feature nova monta seus routers aqui.
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  app.get('/health', async (_req, res) => {
    try {
      await query('select 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(cookieParser);
  app.use(loadSession); // req.user

  // --- routers das features -------------------------------------------------
  app.use(authRouter); // /signup, /login, /logout
  app.use(homeRouter); // GET / — placeholder da vitrine (F02 substitui)
  app.use(organizerRouter); // /organizer, /organizer/events[/:id[/publish]] (F02)

  // --- 404 e erros ----------------------------------------------------------
  app.use((req, res) => {
    renderError(res, 404, 'Página não encontrada', 'O endereço acessado não existe.');
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err?.type === 'entity.parse.failed' || err?.status === 400) {
      return renderError(res, 400, 'Requisição inválida', 'Não foi possível ler os dados enviados.');
    }
    console.error('[app] erro não tratado:', err);
    if (res.headersSent) return res.end();
    render(res, { status: 500, title: 'Erro interno', body: html`<p>Algo deu errado. Tente novamente.</p>` });
  });

  return app;
}
