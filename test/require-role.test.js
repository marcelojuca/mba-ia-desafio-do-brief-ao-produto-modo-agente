import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { resetDb, closeDb } from './helpers/db.js';
import { startTestServer } from './helpers/server.js';
import { createClient, SEED } from './helpers/client.js';
import { cookieParser } from '../src/web/cookies.js';
import { loadSession } from '../src/auth/sessions.js';
import { authRouter } from '../src/auth/routes.js';
import { requireRole, requireLogin } from '../src/auth/middleware.js';

let server;

// App mínimo com as rotas protegidas de teste (as rotas reais chegam nas features seguintes).
function buildApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser);
  app.use(loadSession);
  app.use(authRouter);
  app.get('/only-organizer', requireRole('organizer'), (req, res) => res.send(`org ${req.user.name}`));
  app.get('/only-participant', requireRole('participant'), (req, res) => res.send(`part ${req.user.name}`));
  app.get('/logged', requireLogin, (req, res) => res.send(`ok ${req.user.role}`));
  return app;
}

before(async () => {
  await resetDb();
  server = await startTestServer({ app: buildApp() });
});
after(async () => {
  await server.close();
  await closeDb();
});

describe('requireRole', () => {
  test('requireRole: sem sessão → 302 /login', async () => {
    const c = createClient(server.baseUrl);
    const r = await c.get('/only-organizer');
    assert.equal(r.status, 302);
    assert.equal(r.location, '/login');
  });

  test('requireRole: participante em rota de organizador → 403 "Acesso negado"', async () => {
    const c = createClient(server.baseUrl);
    await c.login(SEED.participant);
    const r = await c.get('/only-organizer');
    assert.equal(r.status, 403);
    assert.match(r.text, /Acesso negado/);
  });

  test('requireRole: organizador em rota de participante → 403 "Acesso negado"', async () => {
    const c = createClient(server.baseUrl);
    await c.login(SEED.orgA);
    const r = await c.get('/only-participant');
    assert.equal(r.status, 403);
    assert.match(r.text, /Acesso negado/);
  });

  test('requireRole: papel certo → 200 com req.user', async () => {
    const org = createClient(server.baseUrl);
    await org.login(SEED.orgB);
    const r1 = await org.get('/only-organizer');
    assert.equal(r1.status, 200);
    assert.equal(r1.text, 'org Organizador B');

    const part = createClient(server.baseUrl);
    await part.login(SEED.participant);
    const r2 = await part.get('/only-participant');
    assert.equal(r2.status, 200);
    assert.equal(r2.text, 'part Participante Seed');
  });
});

describe('requireLogin', () => {
  test('requireLogin: sem sessão → 302 /login; com sessão → 200', async () => {
    const c = createClient(server.baseUrl);
    const r1 = await c.get('/logged');
    assert.equal(r1.status, 302);
    assert.equal(r1.location, '/login');
    await c.login(SEED.participant);
    const r2 = await c.get('/logged');
    assert.equal(r2.status, 200);
    assert.equal(r2.text, 'ok participant');
  });
});
