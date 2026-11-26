import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb, query } from './helpers/db.js';
import { startTestServer } from './helpers/server.js';
import { createClient, SEED } from './helpers/client.js';

let server;

before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
  await closeDb();
});
beforeEach(resetDb);

async function countUsers() {
  const { rows } = await query('select count(*)::int as n from users');
  return rows[0].n;
}

describe('infra web', () => {
  test('GET /health → 200 {"ok":true}', async () => {
    const c = createClient(server.baseUrl);
    const r = await c.get('/health');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true });
  });

  test('GET / (visitante) mostra "Catraca" e links Entrar/Criar conta', async () => {
    const c = createClient(server.baseUrl);
    const r = await c.get('/');
    assert.equal(r.status, 200);
    assert.match(r.text, /Catraca/);
    assert.match(r.text, /Entrar/);
    assert.match(r.text, /Criar conta/);
  });

  test('rota inexistente → 404 em HTML', async () => {
    const c = createClient(server.baseUrl);
    const r = await c.get('/nao-existe');
    assert.equal(r.status, 404);
    assert.match(r.text, /Página não encontrada/);
  });
});

describe('cadastro de participante', () => {
  test('cria participante, loga e redireciona para / mostrando o nome', async () => {
    const c = createClient(server.baseUrl);
    const email = `ana+${Date.now()}@example.com`;
    const r = await c.postForm('/signup', { name: 'Ana', email, password: 'segredo1' });
    assert.equal(r.status, 302);
    assert.equal(r.location, '/');
    assert.ok(c.cookie('catraca_session'), 'cookie de sessão');
    assert.ok(r.setCookies.some((h) => /catraca_session=.*HttpOnly/i.test(h) && /SameSite=Lax/i.test(h)));

    const home = await c.get('/');
    assert.match(home.text, /Ana/);
    assert.match(home.text, /Meus ingressos/);
    assert.match(home.text, /Sair/);

    const { rows } = await query('select role, name from users where email = $1', [email]);
    assert.equal(rows[0].role, 'participant');
    assert.equal(rows[0].name, 'Ana');
  });

  test('e-mail é normalizado para minúsculas', async () => {
    const c = createClient(server.baseUrl);
    const r = await c.postForm('/signup', { name: 'Bia', email: '  Bia@Example.COM ', password: 'segredo1' });
    assert.equal(r.status, 302);
    const { rows } = await query("select 1 from users where email = 'bia@example.com'");
    assert.equal(rows.length, 1);
  });

  test('cadastro nunca cria organizador, mesmo com campo role enviado', async () => {
    const c = createClient(server.baseUrl);
    const r = await c.postForm('/signup', {
      name: 'Hacker',
      email: 'hacker@example.com',
      password: 'segredo1',
      role: 'organizer',
    });
    assert.equal(r.status, 302);
    const { rows } = await query("select role from users where email = 'hacker@example.com'");
    assert.equal(rows[0].role, 'participant');
  });

  test('formulário de cadastro não oferece escolha de papel', async () => {
    const c = createClient(server.baseUrl);
    const r = await c.get('/signup');
    assert.equal(r.status, 200);
    assert.doesNotMatch(r.text, /name="role"/);
    assert.doesNotMatch(r.text, /organizador/i);
  });

  const invalid = [
    ['e-mail já existente', { name: 'Outra', email: SEED.participant, password: 'segredo1' }, /já está cadastrado/],
    ['e-mail duplicado com maiúsculas', { name: 'Outra', email: 'PARTICIPANTE@catraca.dev', password: 'segredo1' }, /já está cadastrado/],
    ['e-mail mal formado', { name: 'Ana', email: 'ana-sem-arroba', password: 'segredo1' }, /E-mail inválido/],
    ['senha de 3 caracteres', { name: 'Ana', email: 'ana3@example.com', password: 'abc' }, /pelo menos 6 caracteres/],
    ['nome vazio', { name: '   ', email: 'ana4@example.com', password: 'segredo1' }, /Informe seu nome/],
  ];
  for (const [label, form, message] of invalid) {
    test(`inválido (${label}) → 422 com mensagem e nenhum usuário criado`, async () => {
      const c = createClient(server.baseUrl);
      const before = await countUsers();
      const r = await c.postForm('/signup', form);
      assert.equal(r.status, 422);
      assert.match(r.text, message);
      assert.equal(c.cookie('catraca_session'), undefined);
      assert.equal(await countUsers(), before);
    });
  }
});

describe('login e logout', () => {
  const seedLogins = [
    [SEED.orgA, '/organizer'],
    [SEED.orgB, '/organizer'],
    [SEED.participant, '/'],
  ];
  for (const [email, location] of seedLogins) {
    test(`login da seed ${email} → 302 ${location} com cookie catraca_session`, async () => {
      const c = createClient(server.baseUrl);
      const r = await c.postForm('/login', { email, password: 'catraca123' });
      assert.equal(r.status, 302);
      assert.equal(r.location, location);
      assert.ok(r.setCookies.some((h) => h.startsWith('catraca_session=')));
    });
  }

  test('senha errada → 401 "E-mail ou senha inválidos" sem cookie de sessão', async () => {
    const c = createClient(server.baseUrl);
    const r = await c.postForm('/login', { email: SEED.orgA, password: 'errada' });
    assert.equal(r.status, 401);
    assert.match(r.text, /E-mail ou senha inválidos/);
    assert.ok(!r.setCookies.some((h) => h.startsWith('catraca_session=')));
  });

  test('e-mail inexistente → 401 com a mesma mensagem', async () => {
    const c = createClient(server.baseUrl);
    const r = await c.postForm('/login', { email: 'ninguem@example.com', password: 'catraca123' });
    assert.equal(r.status, 401);
    assert.match(r.text, /E-mail ou senha inválidos/);
  });

  test('navegação por papel: organizador vê "Meus eventos"', async () => {
    const c = createClient(server.baseUrl);
    await c.login(SEED.orgA);
    const r = await c.get('/');
    assert.match(r.text, /Organizador A/);
    assert.match(r.text, /Meus eventos/);
    assert.doesNotMatch(r.text, /Meus ingressos/);
  });

  test('logout apaga a sessão no banco, limpa o cookie e redireciona para /', async () => {
    const c = createClient(server.baseUrl);
    await c.login(SEED.participant);
    const token = c.cookie('catraca_session');
    assert.ok(token);

    const r = await c.postForm('/logout');
    assert.equal(r.status, 302);
    assert.equal(r.location, '/');
    const { rows } = await query('select 1 from sessions where token = $1', [token]);
    assert.equal(rows.length, 0);

    // cookie antigo reenviado manualmente não autentica mais
    const old = createClient(server.baseUrl);
    old.jar.set('catraca_session', token);
    const home = await old.get('/');
    assert.doesNotMatch(home.text, /Participante Seed/);
    assert.match(home.text, /Entrar/);
  });

  test('sessão expirada não autentica', async () => {
    const c = createClient(server.baseUrl);
    await c.login(SEED.participant);
    await query("update sessions set expires_at = now() - interval '1 minute'");
    const home = await c.get('/');
    assert.doesNotMatch(home.text, /Participante Seed/);
  });
});
