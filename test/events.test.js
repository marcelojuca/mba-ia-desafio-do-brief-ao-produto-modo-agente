import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseEventInput, parsePriceToCents, parseCapacity, MESSAGES } from '../src/events/validation.js';
import { resetDb, closeDb, query, pool } from './helpers/db.js';
import { startTestServer } from './helpers/server.js';
import { createClient, SEED } from './helpers/client.js';
import { toDateTimeLocal } from '../src/web/html.js';
import { registerEditValidator } from '../src/events/edit-validators.js';
import { registerManagementSection } from '../src/events/management-sections.js';
import { listOnSaleEvents } from '../src/events/repo.js';

// ---------------------------------------------------------------------------
// Validação (R01) — unitária, sem banco

const NOW = new Date('2026-11-25T12:00:00-03:00');
const VALID = { name: 'Show', startsAt: '2026-12-05T21:00', venue: 'Bar do Zé', capacity: '2', price: '100,00' };

describe('validação de evento (R01)', () => {
  test('entrada válida → value com centavos e data em −03:00', () => {
    const { value, errors } = parseEventInput(VALID, NOW);
    assert.equal(errors, undefined);
    assert.deepEqual(value, {
      name: 'Show',
      startsAt: new Date('2026-12-06T00:00:00Z'),
      venue: 'Bar do Zé',
      capacity: 2,
      priceCents: 10000,
    });
  });

  test('preço aceita 100, 100,00, 100.00, 1.234,56', () => {
    assert.equal(parsePriceToCents('100'), 10000);
    assert.equal(parsePriceToCents('100,00'), 10000);
    assert.equal(parsePriceToCents('100.00'), 10000);
    assert.equal(parsePriceToCents('1.234,56'), 123456);
    assert.equal(parsePriceToCents('R$ 150,5'), 15050);
    assert.equal(parsePriceToCents(' 0,01 '), 1);
    assert.equal(parsePriceToCents('1.234.567,89'), 123456789);
  });

  test('preço inválido, zero ou negativo é rejeitado', () => {
    for (const price of ['abc', '1,2,3', '10,123', '', '1e3']) {
      assert.ok(parseEventInput({ ...VALID, price }, NOW).errors.price, `price=${price}`);
    }
    for (const price of ['0', '0,00', '-5', '']) {
      assert.equal(parseEventInput({ ...VALID, price }, NOW).errors.price, MESSAGES.pricePositive, `price=${price}`);
    }
  });

  test('lotação precisa ser inteiro ≥ 1', () => {
    assert.equal(parseCapacity('3'), 3);
    for (const capacity of ['0', '1.5', '-1', 'abc', '', '1,0']) {
      assert.equal(parseEventInput({ ...VALID, capacity }, NOW).errors.capacity, MESSAGES.capacity, `capacity=${capacity}`);
    }
  });

  test('data de início no passado ou agora → "A data de início precisa estar no futuro"', () => {
    assert.equal(
      parseEventInput({ ...VALID, startsAt: '2026-11-24T21:00' }, NOW).errors.startsAt,
      'A data de início precisa estar no futuro',
    );
    assert.equal(
      parseEventInput({ ...VALID, startsAt: '2026-11-25T12:00' }, NOW).errors.startsAt,
      'A data de início precisa estar no futuro',
    );
    assert.equal(parseEventInput({ ...VALID, startsAt: '2026-11-25T12:01' }, NOW).errors, undefined);
  });

  test('data mal formada e nome/local vazios ou longos são rejeitados', () => {
    const { errors } = parseEventInput({ ...VALID, startsAt: '2026-02-31T10:00', name: '  ', venue: 'x'.repeat(201) }, NOW);
    assert.equal(errors.startsAt, MESSAGES.startsAtInvalid);
    assert.equal(errors.name, MESSAGES.nameRequired);
    assert.equal(errors.venue, MESSAGES.venueTooLong);
    assert.equal(parseEventInput({}, NOW).errors.name, MESSAGES.nameRequired);
  });
});

// ---------------------------------------------------------------------------
// HTTP

let server;

before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
  await closeDb();
});

const DAY = 24 * 60 * 60 * 1000;
// "mês seguinte" e "ontem" no formato datetime-local (−03:00)
function nextMonthAt(hhmm = '21:00') {
  return `${toDateTimeLocal(new Date(Date.now() + 31 * DAY)).slice(0, 10)}T${hhmm}`;
}
function yesterdayAt(hhmm = '21:00') {
  return `${toDateTimeLocal(new Date(Date.now() - DAY)).slice(0, 10)}T${hhmm}`;
}

function e1Form(overrides = {}) {
  return { name: 'E1', startsAt: nextMonthAt(), venue: 'Bar do Zé', capacity: '2', price: '100,00', ...overrides };
}

async function as(email) {
  const c = createClient(server.baseUrl);
  await c.login(email);
  return c;
}

async function createE1(client, overrides = {}) {
  const r = await client.postForm('/organizer/events', e1Form(overrides));
  assert.equal(r.status, 302, r.text);
  const m = /^\/organizer\/events\/(evt_[0-9a-z]{12})$/.exec(r.location);
  assert.ok(m, `Location inesperado: ${r.location}`);
  return m[1];
}

async function countEvents() {
  const { rows } = await query('select count(*)::int as n from events');
  return rows[0].n;
}

async function eventRow(id) {
  const { rows } = await query('select * from events where id = $1', [id]);
  return rows[0];
}

describe('área do organizador', () => {
  beforeEach(resetDb);

  test('CF01-SEED-ORGS-01: A e B da seed chegam a "Meus eventos" com o próprio nome', async () => {
    for (const [email, name] of [
      [SEED.orgA, /Organizador A|Organizadora A/i],
      [SEED.orgB, /Organizador B|Organizadora B/i],
    ]) {
      const c = await as(email);
      const r = await c.get('/organizer');
      assert.equal(r.status, 200);
      assert.match(r.text, /Meus eventos/);
      assert.match(r.text, /data-user-role="organizer"/);
      const { rows } = await query('select name from users where email = $1', [email]);
      assert.ok(r.text.includes(rows[0].name), `nome ${rows[0].name} no cabeçalho`);
      assert.match(rows[0].name, name);
      assert.match(r.text, /Novo evento/);
    }
  });

  test('EVT-CREATE-01: criação válida nasce rascunho e gestão mostra os dados', async () => {
    const a = await as(SEED.orgA);
    const id = await createE1(a);
    const r = await a.get(`/organizer/events/${id}`);
    assert.equal(r.status, 200);
    assert.match(r.text, /E1/);
    assert.match(r.text, /Rascunho/);
    assert.match(r.text, /data-event-status="draft"/);
    assert.match(r.text, /R\$ 100,00/);
    assert.match(r.text, /<dd data-event-capacity>2<\/dd>/);
    assert.match(r.text, /Bar do Zé/);
    const row = await eventRow(id);
    assert.equal(row.status, 'draft');
    assert.equal(row.price_cents, 10000);
    assert.equal(row.capacity, 2);
    assert.equal(toDateTimeLocal(row.starts_at), e1Form().startsAt.slice(0, 16));
    // aparece na lista de A
    const list = await a.get('/organizer');
    assert.ok(list.text.includes(id));
    assert.match(list.text, /E1/);
  });

  test('preço aceita 100, 100.00 e 1.234,56 na criação', async () => {
    const a = await as(SEED.orgA);
    for (const [price, cents] of [['100', 10000], ['100.00', 10000], ['1.234,56', 123456]]) {
      const id = await createE1(a, { price });
      assert.equal((await eventRow(id)).price_cents, cents, price);
    }
  });

  test('EVT-CREATE-02: data no passado rejeitada na criação', async () => {
    const a = await as(SEED.orgA);
    const r = await a.postForm('/organizer/events', e1Form({ startsAt: yesterdayAt() }));
    assert.equal(r.status, 422);
    assert.match(r.text, /A data de início precisa estar no futuro/);
    assert.equal(await countEvents(), 0);
    const list = await a.get('/organizer');
    assert.doesNotMatch(list.text, /data-event-id=/);
  });

  test('EVT-CREATE-03: lotação 0 / 1.5, preço 0 e nome vazio → 422 sem criar', async () => {
    const a = await as(SEED.orgA);
    const cases = [
      [{ capacity: '0' }, 'Lotação deve ser um inteiro maior ou igual a 1'],
      [{ capacity: '1.5' }, 'Lotação deve ser um inteiro maior ou igual a 1'],
      [{ price: '0' }, 'Preço deve ser maior que zero'],
      [{ name: '' }, 'Informe o nome do evento'],
    ];
    for (const [overrides, message] of cases) {
      const r = await a.postForm('/organizer/events', e1Form(overrides));
      assert.equal(r.status, 422, JSON.stringify(overrides));
      assert.ok(r.text.includes(message), `${JSON.stringify(overrides)} → ${message}`);
    }
    assert.equal(await countEvents(), 0);
  });

  test('EVT-DRAFT-01 / EVT-PUBLISH-01: rascunho fora da vitrine; publicado aparece; publicar de novo → 409', async () => {
    const a = await as(SEED.orgA);
    const id = await createE1(a);
    const visitor = createClient(server.baseUrl);

    let home = await visitor.get('/');
    assert.equal(home.status, 200);
    assert.doesNotMatch(home.text, /E1/);
    assert.ok(!home.text.includes(id));
    assert.match(home.text, /Nenhum evento à venda no momento/);

    const pub = await a.postForm(`/organizer/events/${id}/publish`);
    assert.equal(pub.status, 303);
    assert.equal(pub.location, `/organizer/events/${id}`);
    const mgmt = await a.get(`/organizer/events/${id}`);
    assert.match(mgmt.text, /Publicado/);
    assert.match(mgmt.text, /data-event-status="published"/);
    assert.match(mgmt.text, /data-notice>Evento publicado/);
    assert.doesNotMatch(mgmt.text, /action="\/organizer\/events\/[^"]+\/publish"/);

    home = await visitor.get('/');
    assert.match(home.text, new RegExp(`data-event-id="${id}"`));
    assert.match(home.text, /E1/);
    const when = e1Form().startsAt;
    const expectedDate = `${when.slice(8, 10)}/${when.slice(5, 7)}/${when.slice(0, 4)} 21:00`;
    assert.ok(home.text.includes(expectedDate), `data ${expectedDate}`);
    assert.match(home.text, /R\$ 100,00/);
    assert.match(home.text, /Bar do Zé/);

    const again = await a.postForm(`/organizer/events/${id}/publish`);
    assert.equal(again.status, 409);
    assert.equal((await eventRow(id)).status, 'published');
  });

  test('vitrine lista só publicados, em ordem de início (listOnSaleEvents)', async () => {
    const a = await as(SEED.orgA);
    const later = await createE1(a, { name: 'Depois', startsAt: nextMonthAt('22:00') });
    const sooner = await createE1(a, { name: 'Antes', startsAt: nextMonthAt('20:00') });
    await createE1(a, { name: 'Rascunho X' });
    await a.postForm(`/organizer/events/${later}/publish`);
    await a.postForm(`/organizer/events/${sooner}/publish`);
    const events = await listOnSaleEvents();
    assert.deepEqual(events.map((e) => e.id), [sooner, later]);
    const home = await createClient(server.baseUrl).get('/');
    assert.ok(home.text.indexOf(sooner) < home.text.indexOf(later));
    assert.doesNotMatch(home.text, /Rascunho X/);
  });

  test('EVT-MGMT-01: cada evento tem sua URL de gestão com formulário de edição e botão Publicar', async () => {
    const a = await as(SEED.orgA);
    const id1 = await createE1(a);
    const id2 = await createE1(a, { name: 'E2', venue: 'Teatro', capacity: '7', price: '35' });
    assert.notEqual(id1, id2);
    const r1 = await a.get(`/organizer/events/${id1}`);
    const r2 = await a.get(`/organizer/events/${id2}`);
    for (const [r, id] of [[r1, id1], [r2, id2]]) {
      assert.equal(r.status, 200);
      assert.ok(r.text.includes(`action="/organizer/events/${id}"`), 'form de edição');
      assert.ok(r.text.includes(`action="/organizer/events/${id}/publish"`), 'botão publicar');
      assert.match(r.text, />Publicar</);
    }
    assert.match(r2.text, /E2/);
    assert.match(r2.text, /Teatro/);
    assert.match(r2.text, /R\$ 35,00/);
    assert.match(r2.text, /<dd data-event-capacity>7<\/dd>/);
    assert.doesNotMatch(r2.text, /Bar do Zé/);
  });

  test('EVT-EDIT-01: editar preço e aumentar lotação (rascunho e publicado)', async () => {
    const a = await as(SEED.orgA);
    const id = await createE1(a);
    let r = await a.postForm(`/organizer/events/${id}`, e1Form({ price: '150,00', capacity: '3' }));
    assert.equal(r.status, 303);
    assert.equal(r.location, `/organizer/events/${id}`);
    let page = await a.get(r.location);
    assert.match(page.text, /R\$ 150,00/);
    assert.match(page.text, /<dd data-event-capacity>3<\/dd>/);
    assert.match(page.text, /data-notice>Evento atualizado/);

    await a.postForm(`/organizer/events/${id}/publish`);
    r = await a.postForm(`/organizer/events/${id}`, e1Form({ name: 'E1 editado', price: '1.234,56', capacity: '10' }));
    assert.equal(r.status, 303);
    const row = await eventRow(id);
    assert.equal(row.name, 'E1 editado');
    assert.equal(row.price_cents, 123456);
    assert.equal(row.capacity, 10);
    assert.equal(row.status, 'published');
  });

  test('EVT-EDIT-02: data no passado (e campos inválidos) rejeitados na edição; dados inalterados', async () => {
    const a = await as(SEED.orgA);
    const id = await createE1(a);
    const before = await eventRow(id);
    let r = await a.postForm(`/organizer/events/${id}`, e1Form({ startsAt: yesterdayAt(), price: '999,00' }));
    assert.equal(r.status, 422);
    assert.match(r.text, /A data de início precisa estar no futuro/);
    assert.match(r.text, /data-event-status="draft"/); // é a página de gestão
    r = await a.postForm(`/organizer/events/${id}`, e1Form({ capacity: '0' }));
    assert.equal(r.status, 422);
    assert.match(r.text, /Lotação deve ser um inteiro maior ou igual a 1/);
    r = await a.postForm(`/organizer/events/${id}`, e1Form({ price: '0,00' }));
    assert.equal(r.status, 422);
    assert.match(r.text, /Preço deve ser maior que zero/);
    assert.deepEqual(await eventRow(id), before);
  });

  test('editar evento já começado exige nova data futura', async () => {
    const a = await as(SEED.orgA);
    const id = await createE1(a);
    await query("update events set starts_at = now() - interval '1 hour' where id = $1", [id]);
    const page = await a.get(`/organizer/events/${id}`);
    const startsAt = /name="startsAt"[^>]*value="([^"]+)"/.exec(page.text)[1];
    const r = await a.postForm(`/organizer/events/${id}`, e1Form({ startsAt, price: '120' }));
    assert.equal(r.status, 422);
    assert.match(r.text, /A data de início precisa estar no futuro/);
    assert.equal((await eventRow(id)).price_cents, 10000);
  });
});

describe('isolamento e papéis (R13)', () => {
  beforeEach(resetDb);

  test('ACL-LIST-01: B não vê eventos de A na lista', async () => {
    const a = await as(SEED.orgA);
    const id = await createE1(a);
    const b = await as(SEED.orgB);
    const r = await b.get('/organizer');
    assert.equal(r.status, 200);
    assert.doesNotMatch(r.text, /E1/);
    assert.ok(!r.text.includes(id));
  });

  test('ACL-DIRECT-01: B na URL de A (GET, edição, publicar) → 404 sem dados; E1 inalterado', async () => {
    const a = await as(SEED.orgA);
    const id = await createE1(a, { venue: 'Bar do Zé', price: '100,00', capacity: '2' });
    const before = await eventRow(id);
    const b = await as(SEED.orgB);
    const responses = [
      await b.get(`/organizer/events/${id}`),
      await b.postForm(`/organizer/events/${id}`, e1Form({ name: 'Hackeado', price: '1,00', capacity: '99' })),
      await b.postForm(`/organizer/events/${id}/publish`),
    ];
    for (const r of responses) {
      assert.equal(r.status, 404);
      assert.match(r.text, /Evento não encontrado/);
      assert.doesNotMatch(r.text, /E1|Bar do Zé|100,00|data-event-capacity|data-event-status/);
      assert.ok(!r.text.includes(id));
    }
    assert.deepEqual(await eventRow(id), before);
    // inexistente → mesma resposta
    const missing = await b.get('/organizer/events/evt_000000000000');
    assert.equal(missing.status, 404);
    assert.match(missing.text, /Evento não encontrado/);
  });

  test('ACL-ROLE-01: participante → 403 sem dados; visitante → 302 /login (GET e POST)', async () => {
    const a = await as(SEED.orgA);
    const id = await createE1(a);
    const before = await eventRow(id);
    const p = await as(SEED.participant);
    const visitor = createClient(server.baseUrl);
    const paths = ['/organizer', `/organizer/events/${id}`, '/organizer/events/new'];
    for (const path of paths) {
      const r = await p.get(path);
      assert.equal(r.status, 403, path);
      assert.match(r.text, /Acesso negado/);
      assert.doesNotMatch(r.text, /E1|Bar do Zé/);
      const v = await visitor.get(path);
      assert.equal(v.status, 302, path);
      assert.equal(v.location, '/login');
    }
    for (const path of ['/organizer/events', `/organizer/events/${id}`, `/organizer/events/${id}/publish`]) {
      const r = await p.postForm(path, e1Form({ name: 'X' }));
      assert.equal(r.status, 403, path);
      const v = await visitor.postForm(path, e1Form({ name: 'X' }));
      assert.equal(v.status, 302, path);
      assert.equal(v.location, '/login');
    }
    assert.equal(await countEvents(), 1);
    assert.deepEqual(await eventRow(id), before);
  });
});

describe('evento cancelado e pontos de extensão', () => {
  beforeEach(resetDb);

  test('cancelado: sem formulário de edição nem Publicar; edição e publicação → 409', async () => {
    const a = await as(SEED.orgA);
    const id = await createE1(a);
    await a.postForm(`/organizer/events/${id}/publish`);
    await query("update events set status = 'cancelled' where id = $1", [id]);
    const before = await eventRow(id);

    const page = await a.get(`/organizer/events/${id}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /data-event-status="cancelled"/);
    assert.match(page.text, /Cancelado/);
    assert.doesNotMatch(page.text, /data-form="edit-event"/);
    assert.doesNotMatch(page.text, /data-form="publish"/);

    const edit = await a.postForm(`/organizer/events/${id}`, e1Form({ price: '1,00' }));
    assert.equal(edit.status, 409);
    assert.match(edit.text, /Evento cancelado não pode ser editado/);
    assert.doesNotMatch(edit.text, /data-form="edit-event"/);
    const publish = await a.postForm(`/organizer/events/${id}/publish`);
    assert.equal(publish.status, 409);
    assert.deepEqual(await eventRow(id), before);

    const home = await createClient(server.baseUrl).get('/');
    assert.ok(!home.text.includes(id));
  });

  test('validadores registrados rodam na edição, com a linha do evento travada (FOR UPDATE)', async () => {
    const a = await as(SEED.orgA);
    const id = await createE1(a);
    const calls = [];
    const unregister = registerEditValidator(async ({ client, event, next }) => {
      // outra conexão não consegue travar a linha enquanto a edição está em andamento
      const other = await pool.connect();
      let locked = false;
      try {
        await other.query('begin');
        await other.query('select 1 from events where id = $1 for update nowait', [event.id]);
      } catch (err) {
        locked = err.code === '55P03';
      } finally {
        await other.query('rollback');
        other.release();
      }
      const { rows } = await client.query('select capacity from events where id = $1', [event.id]);
      calls.push({ locked, current: rows[0].capacity, next: next.capacity });
      return next.capacity < 2 ? 'A lotação não pode ser menor que as vagas ocupadas (2)' : null;
    });
    try {
      let r = await a.postForm(`/organizer/events/${id}`, e1Form({ capacity: '1' }));
      assert.equal(r.status, 422);
      assert.match(r.text, /A lotação não pode ser menor que as vagas ocupadas \(2\)/);
      assert.equal((await eventRow(id)).capacity, 2);
      r = await a.postForm(`/organizer/events/${id}`, e1Form({ capacity: '5' }));
      assert.equal(r.status, 303);
      assert.equal((await eventRow(id)).capacity, 5);
      assert.deepEqual(calls, [
        { locked: true, current: 2, next: 1 },
        { locked: true, current: 2, next: 5 },
      ]);
    } finally {
      unregister();
    }
  });

  test('seções registradas aparecem na gestão em ordem e não vazam para outro organizador', async () => {
    const a = await as(SEED.orgA);
    const id = await createE1(a);
    registerManagementSection({
      id: 'test-late',
      order: 90,
      render: ({ event }) => `<p data-test-section="late">${event.status}</p>`,
    });
    registerManagementSection({
      id: 'test-early',
      order: 10,
      render: async ({ event, flash }) => `<p data-test-section="early">${event.id}|${flash ?? ''}</p>`,
    });
    registerManagementSection({ id: 'test-hidden', order: 50, render: () => null });
    const r = await a.get(`/organizer/events/${id}`); // flash da criação ainda pendente
    assert.equal(r.status, 200);
    const early = r.text.indexOf('data-test-section="early"');
    const late = r.text.indexOf('data-test-section="late"');
    assert.ok(early > 0 && late > early, 'ordem das seções');
    assert.ok(r.text.includes(`${id}|Evento criado como rascunho`));
    assert.match(r.text, /data-notice>Evento criado como rascunho/);
    assert.doesNotMatch(r.text, /data-section="test-hidden"/);
    const b = await as(SEED.orgB);
    const other = await b.get(`/organizer/events/${id}`);
    assert.equal(other.status, 404);
    assert.doesNotMatch(other.text, /data-test-section/);
    // remove as seções de teste
    for (const sid of ['test-late', 'test-early']) registerManagementSection({ id: sid, render: () => null });
  });
});
