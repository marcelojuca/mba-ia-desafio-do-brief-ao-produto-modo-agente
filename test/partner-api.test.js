import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb, query } from './helpers/db.js';
import { startTestServer } from './helpers/server.js';
import { createClient, SEED } from './helpers/client.js';
import { createEventRow, countTickets, ticketsOf, card } from './helpers/fixtures.js';
import { isValidApiKey } from '../src/partner/auth.js';
import { config } from '../src/config.js';

// API de parceiros (F04) com o worker do gateway ligado (GATEWAY_DELAY_SCALE=0.01 nos gates).
let server;
before(async () => {
  server = await startTestServer({ backgroundJobs: true });
});
after(async () => {
  await server.close();
  await closeDb();
});

const KEY = config.partnerApiKey;
const AUTH = { 'X-Api-Key': KEY };
const VALID = Object.freeze({ buyerEmail: 'comprador@example.com', cardNumber: card('0001') });

function api() {
  return createClient(server.baseUrl);
}
const listEvents = (headers = AUTH) => api().get('/api/partner/events', { headers });
const buy = (eventId, body = VALID, headers = AUTH) =>
  api().postJson(`/api/partner/events/${encodeURIComponent(eventId)}/purchases`, body, headers);
const getTicket = (ticketId, headers = AUTH) =>
  api().get(`/api/partner/tickets/${encodeURIComponent(ticketId)}`, { headers });

async function as(email) {
  const c = createClient(server.baseUrl);
  await c.login(email);
  return c;
}

async function waitFor(fn, timeoutMs = 3000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v || Date.now() - t0 > timeoutMs) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
}

const ISO_BRT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$/;

describe('isValidApiKey', () => {
  test('aceita só a chave configurada', () => {
    assert.equal(isValidApiKey(KEY), true);
    assert.equal(isValidApiKey('errada'), false);
    assert.equal(isValidApiKey(`${KEY}x`), false);
    assert.equal(isValidApiKey(''), false);
    assert.equal(isValidApiKey(undefined), false);
  });
});

describe('API de parceiros (HTTP)', () => {
  beforeEach(resetDb);

  test('API-AUTH-01: 401 {"error":"unauthorized"} nas três rotas sem chave e com chave errada; nada é criado', async () => {
    const e = await createEventRow({ capacity: 5 });
    const calls = [
      (h) => listEvents(h),
      (h) => buy(e.id, VALID, h),
      (h) => getTicket('tkt_qualquer', h),
      (h) => buy(e.id, '{malformado', h), // auth vem antes do parse do corpo
      (h) => api().get('/api/partner/rota-inexistente', { headers: h }),
    ];
    for (const headers of [{}, { 'X-Api-Key': 'errada' }, { 'X-Api-Key': '' }]) {
      for (const call of calls) {
        const r = await call(headers);
        assert.equal(r.status, 401);
        assert.equal(r.text, '{"error":"unauthorized"}');
        assert.match(r.headers.get('content-type'), /application\/json/);
      }
    }
    assert.equal(await countTickets(), 0);
  });

  test('API-LIST-01: só publicados, formato exato (5 chaves, startsAt −03:00), rascunho entra após publicar', async () => {
    const startsAt = new Date('2026-12-06T00:00:00Z'); // 05/12/2026 21:00 em −03:00
    const draft = await createEventRow({ name: 'Jazz no Porão', capacity: 2, priceCents: 10000, status: 'draft', startsAt });
    const cancelled = await createEventRow({ name: 'Cancelado', status: 'cancelled' });
    const other = await createEventRow({ name: 'Outro', organizerEmail: SEED.orgB, capacity: 3, priceCents: 2550 });

    let r = await listEvents();
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.json));
    let ids = r.json.map((e) => e.id);
    assert.ok(!ids.includes(draft.id));
    assert.ok(!ids.includes(cancelled.id));
    assert.ok(ids.includes(other.id));

    const a = await as(SEED.orgA);
    const pub = await a.postForm(`/organizer/events/${draft.id}/publish`);
    assert.equal(pub.status, 303);

    r = await listEvents();
    ids = r.json.map((e) => e.id);
    assert.ok(ids.includes(draft.id));
    assert.ok(!ids.includes(cancelled.id));
    const item = r.json.find((e) => e.id === draft.id);
    assert.deepEqual(item, {
      id: draft.id,
      name: 'Jazz no Porão',
      startsAt: '2026-12-05T21:00:00-03:00',
      priceCents: 10000,
      availableSeats: 2,
    });
    assert.deepEqual(Object.keys(item), ['id', 'name', 'startsAt', 'priceCents', 'availableSeats']);
    for (const e of r.json) {
      assert.equal(typeof e.id, 'string');
      assert.match(e.startsAt, ISO_BRT);
      assert.equal(typeof e.priceCents, 'number');
      assert.equal(typeof e.availableSeats, 'number');
    }
  });

  test('API-ERR-01: ordem 422 → 404 → 409 com corpos exatos', async () => {
    const draft = await createEventRow({ status: 'draft', capacity: 1 });
    const cancelled = await createEventRow({ status: 'cancelled', capacity: 1 });
    const full = await createEventRow({ capacity: 1 });
    assert.equal((await buy(full.id)).status, 202);

    const INVALID = '{"error":"invalid_request"}';
    const NOT_AVAILABLE = '{"error":"event_not_available"}';
    const SOLD_OUT = '{"error":"sold_out"}';
    const cases = [
      // 422 antes de 404: corpo inválido em evento inexistente / rascunho / esgotado
      ['evt_inexistente', { buyerEmail: 'x@example.com', cardNumber: '123' }, 422, INVALID],
      [draft.id, { buyerEmail: 'x@example.com', cardNumber: '123' }, 422, INVALID],
      [full.id, { cardNumber: card('0001') }, 422, INVALID],
      [full.id, { buyerEmail: 'nao-e-email', cardNumber: card('0001') }, 422, INVALID],
      [full.id, { buyerEmail: 'x@example.com' }, 422, INVALID],
      [full.id, { buyerEmail: 'x@example.com', cardNumber: 4000000000000001 }, 422, INVALID],
      [full.id, { buyerEmail: 'x@example.com', cardNumber: '4000 0000 0000 0001' }, 422, INVALID],
      [full.id, { buyerEmail: 'x@example.com', cardNumber: '40000000000000011' }, 422, INVALID],
      [full.id, { buyerEmail: ['x@example.com'], cardNumber: card('0001') }, 422, INVALID],
      [full.id, '{"buyerEmail":"x@example.com",', 422, INVALID], // JSON malformado
      [full.id, '[]', 422, INVALID],
      [full.id, '"texto"', 422, INVALID],
      [full.id, '', 422, INVALID],
      // 404 antes de 409: evento inexistente, rascunho (também sem vaga), cancelado
      ['evt_inexistente', VALID, 404, NOT_AVAILABLE],
      [draft.id, VALID, 404, NOT_AVAILABLE],
      [cancelled.id, VALID, 404, NOT_AVAILABLE],
      // 409: publicado sem vaga
      [full.id, VALID, 409, SOLD_OUT],
    ];
    for (const [eventId, body, status, text] of cases) {
      const r = await buy(eventId, body);
      assert.equal(r.status, status, `${eventId} ${JSON.stringify(body)} → ${r.status} ${r.text}`);
      assert.equal(r.text, text);
    }
    // Rascunho sem vaga também é 404 (evento antes de vagas).
    await query("update events set status = 'draft' where id = $1", [full.id]);
    const r = await buy(full.id);
    assert.equal(r.status, 404);
    assert.equal(r.text, NOT_AVAILABLE);

    // Sem Content-Type JSON o corpo não é lido → 422.
    const raw = await api().request('POST', `/api/partner/events/${draft.id}/purchases`, {
      body: JSON.stringify(VALID),
      headers: { ...AUTH, 'content-type': 'text/plain' },
    });
    assert.equal(raw.status, 422);
    assert.equal(raw.text, INVALID);

    assert.equal(await countTickets(), 1);
  });

  test('API-BUY-01: 202 pending, ocupa vaga, passa pelo gateway (0004 → declined libera; 0001 → confirmed)', async () => {
    const e = await createEventRow({ capacity: 2 });

    const r = await buy(e.id, { buyerEmail: 'parceiro@example.com', cardNumber: card('0004') });
    assert.equal(r.status, 202);
    assert.deepEqual(Object.keys(r.json), ['ticketId', 'code', 'status']);
    assert.match(r.json.ticketId, /^tkt_[0-9a-z]{12}$/);
    assert.match(r.json.code, /^[A-Z0-9]{8}$/);
    assert.equal(r.json.status, 'pending');

    const [row] = await ticketsOf(e.id);
    assert.equal(row.id, r.json.ticketId);
    assert.equal(row.channel, 'partner');
    assert.equal(row.user_id, null);
    assert.equal(row.buyer_email, 'parceiro@example.com');
    assert.equal(row.price_cents, e.price_cents);

    const seats = async () => (await listEvents()).json.find((x) => x.id === e.id).availableSeats;
    assert.equal(await seats(), 1);

    const declined = await waitFor(async () => (await getTicket(r.json.ticketId)).json.status === 'declined', 5000);
    assert.ok(declined, 'ingresso 0004 deveria ficar declined');
    assert.equal(await seats(), 2);

    const ok = await buy(e.id, { buyerEmail: 'parceiro@example.com', cardNumber: card('0001') });
    assert.equal(ok.status, 202);
    const confirmed = await waitFor(async () => (await getTicket(ok.json.ticketId)).json.status === 'confirmed', 5000);
    assert.ok(confirmed, 'ingresso 0001 deveria ficar confirmed');
    assert.equal(await seats(), 1);
  });

  test('API-TICKET-01: ingresso da vitrine e do parceiro, formato exato, checkedIn false', async () => {
    const e = await createEventRow({ capacity: 3 });
    const p = await as(SEED.participant);
    const web = await p.postForm(`/events/${e.id}/purchase`, { cardNumber: card('0001') });
    assert.equal(web.status, 303);
    const partner = await buy(e.id);
    assert.equal(partner.status, 202);

    const rows = await ticketsOf(e.id);
    const webRow = rows.find((t) => t.channel === 'web');
    assert.ok(webRow);
    const myTickets = await p.get('/my-tickets');
    assert.ok(myTickets.text.includes(`data-ticket-code="${webRow.code}"`));

    for (const t of rows) {
      const r = await getTicket(t.id);
      assert.equal(r.status, 200);
      assert.deepEqual(Object.keys(r.json), ['ticketId', 'code', 'eventId', 'status', 'checkedIn']);
      assert.equal(r.json.ticketId, t.id);
      assert.equal(r.json.code, t.code);
      assert.equal(r.json.eventId, e.id);
      assert.ok(['pending', 'confirmed'].includes(r.json.status));
      assert.equal(r.json.checkedIn, false);
    }
    const confirmed = await waitFor(async () => (await getTicket(webRow.id)).json.status === 'confirmed', 5000);
    assert.ok(confirmed);
  });

  test('API-TICKET-01b: checkedIn reflete tickets.checked_in_at quando a coluna existe (F05)', async () => {
    const e = await createEventRow({ capacity: 2 });
    const r = await buy(e.id);
    const { rows } = await query(
      "select 1 from information_schema.columns where table_name = 'tickets' and column_name = 'checked_in_at'",
    );
    const added = rows.length === 0;
    if (added) await query('alter table tickets add column checked_in_at timestamptz');
    try {
      assert.equal((await getTicket(r.json.ticketId)).json.checkedIn, false);
      await query('update tickets set checked_in_at = now() where id = $1', [r.json.ticketId]);
      assert.equal((await getTicket(r.json.ticketId)).json.checkedIn, true);
    } finally {
      if (added) await query('alter table tickets drop column checked_in_at');
    }
  });

  test('API-TICKET-02: ingresso inexistente → 404 {"error":"ticket_not_found"}', async () => {
    const r = await getTicket('tkt_naoexiste');
    assert.equal(r.status, 404);
    assert.equal(r.text, '{"error":"ticket_not_found"}');
  });

  test('API-SOLDOUT-WEB-01: vaga ocupada pela vitrine conta na API', async () => {
    const e = await createEventRow({ capacity: 1 });
    const p = await as(SEED.participant);
    assert.equal((await p.postForm(`/events/${e.id}/purchase`, { cardNumber: card('0001') })).status, 303);
    const list = await listEvents();
    assert.equal(list.json.find((x) => x.id === e.id).availableSeats, 0);
    const r = await buy(e.id);
    assert.equal(r.status, 409);
    assert.equal(r.text, '{"error":"sold_out"}');
  });

  test('API-CONC-01: 30 compras simultâneas em lotação 5 → 5×202 e 25×409, em 2 rodadas', async () => {
    for (let round = 1; round <= 2; round++) {
      const e = await createEventRow({ name: `Carga ${round}`, capacity: 5 });
      const responses = await Promise.all(
        Array.from({ length: 30 }, (_, i) =>
          buy(e.id, { buyerEmail: `carga${i + 1}@example.com`, cardNumber: card('0001') }),
        ),
      );
      const counts = {};
      for (const r of responses) counts[r.status] = (counts[r.status] || 0) + 1;
      assert.deepEqual(counts, { 202: 5, 409: 25 }, `rodada ${round}`);
      for (const r of responses.filter((x) => x.status === 409)) assert.equal(r.text, '{"error":"sold_out"}');

      const tickets = await ticketsOf(e.id);
      assert.equal(tickets.length, 5);
      assert.equal(new Set(tickets.map((t) => t.code)).size, 5);

      const allConfirmed = await waitFor(async () => {
        const ts = await ticketsOf(e.id);
        return ts.every((t) => t.status === 'confirmed');
      }, 5000);
      assert.ok(allConfirmed, `rodada ${round}: os 5 ingressos deveriam ficar confirmed`);
      assert.equal((await listEvents()).json.find((x) => x.id === e.id).availableSeats, 0);
    }
  });

  test('rota inexistente sob /api/partner com chave válida → 404 JSON', async () => {
    const r = await api().get('/api/partner/nada', { headers: AUTH });
    assert.equal(r.status, 404);
    assert.equal(r.text, '{"error":"not_found"}');
  });
});
