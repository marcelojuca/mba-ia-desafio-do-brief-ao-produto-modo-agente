import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb, query } from './helpers/db.js';
import { startTestServer } from './helpers/server.js';
import { createClient, SEED } from './helpers/client.js';
import { createEventRow } from './helpers/fixtures.js';
import { buyWeb, buyPartner, settle } from './helpers/tickets-control.js';
import { getPanelMetrics } from '../src/panel/service.js';
import { toDateTimeLocal } from '../src/web/html.js';
import { centsToPriceInput } from '../src/events/page.js';

// Painel do evento (F05.P2, R12). Servidor sem worker; o gateway é liquidado por settle().
let server;
before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
  await closeDb();
});
beforeEach(resetDb);

async function as(email) {
  const c = createClient(server.baseUrl);
  await c.login(email);
  return c;
}

const METRICS = ['confirmed', 'pending', 'checkins', 'available', 'revenue', 'refunded'];

function metrics(text) {
  const out = {};
  for (const key of METRICS) {
    const m = new RegExp(`<dd data-metric="${key}">([^<]*)</dd>`).exec(text);
    assert.ok(m, `métrica ${key} ausente`);
    out[key] = m[1];
  }
  return out;
}

async function panel(client, eventId) {
  const r = await client.get(`/organizer/events/${eventId}`);
  assert.equal(r.status, 200, r.text);
  return metrics(r.text);
}

const checkin = (client, eventId, code) => client.postForm(`/organizer/events/${eventId}/checkin`, { code });

describe('painel (HTTP)', () => {
  test('seção "Painel" com os seis rótulos, antes do check-in; evento sem ingressos zerado', async () => {
    const a = await as(SEED.orgA);
    const e = await createEventRow({ capacity: 4 });
    const r = await a.get(`/organizer/events/${e.id}`);
    assert.match(r.text, /<section data-section="panel">\s*<h2>Painel<\/h2>/);
    for (const label of ['Confirmados', 'Pendentes', 'Check-ins', 'Vagas disponíveis', 'Receita', 'Estornados']) {
      assert.match(r.text, new RegExp(`<dt>${label}</dt>`), label);
    }
    assert.ok(r.text.indexOf('data-section="panel"') < r.text.indexOf('data-section="checkin"'));
    assert.deepEqual(metrics(r.text), {
      confirmed: '0', pending: '0', checkins: '0', available: '4', revenue: 'R$ 0,00', refunded: '0',
    });
  });

  test('PANEL-01: cenário base com canais web e partner (CF-07, CF-08)', async () => {
    const a = await as(SEED.orgA);
    const p = await as(SEED.participant);
    const e = await createEventRow({ capacity: 3, priceCents: 10000 });
    const c1 = await buyWeb(p, e.id, '0001');
    assert.equal(await settle(c1.id), 'confirmed');
    const c2 = await buyPartner(e.id, '0004'); // pendente
    assert.match((await checkin(a, e.id, c1.code)).text, /data-checkin-result="ok"/);

    assert.deepEqual(await panel(a, e.id), {
      confirmed: '1', pending: '1', checkins: '1', available: '1', revenue: 'R$ 100,00', refunded: '0',
    });

    assert.equal(await settle(c2.id), 'declined');
    assert.deepEqual(await panel(a, e.id), {
      confirmed: '1', pending: '0', checkins: '1', available: '2', revenue: 'R$ 100,00', refunded: '0',
    });
  });

  test('confirmado vindo do canal partner também conta em Confirmados, Check-ins e Receita', async () => {
    const a = await as(SEED.orgA);
    const e = await createEventRow({ capacity: 3 });
    const t = await buyPartner(e.id, '0003');
    assert.equal(await settle(t.id), 'confirmed');
    assert.match((await checkin(a, e.id, t.code)).text, /data-checkin-result="ok"/);
    assert.deepEqual(await panel(a, e.id), {
      confirmed: '1', pending: '0', checkins: '1', available: '2', revenue: 'R$ 100,00', refunded: '0',
    });
  });

  test('PANEL-REVENUE-01: receita com o preço do momento da compra; estornado fora da receita', async () => {
    const a = await as(SEED.orgA);
    const p = await as(SEED.participant);
    const g = await createEventRow({ capacity: 5, priceCents: 10000 });
    for (const t of [await buyWeb(p, g.id, '0001'), await buyPartner(g.id, '0001')]) {
      assert.equal(await settle(t.id), 'confirmed');
    }

    const edit = await a.postForm(`/organizer/events/${g.id}`, {
      name: g.name,
      startsAt: toDateTimeLocal(g.starts_at),
      venue: g.venue,
      capacity: String(g.capacity),
      price: centsToPriceInput(15000),
    });
    assert.equal(edit.status, 303, edit.text);

    const third = await buyWeb(p, g.id, '0001');
    assert.equal(await settle(third.id), 'confirmed');
    assert.equal(third.price_cents, 15000);
    const extra = await buyPartner(g.id, '0003');
    assert.equal(await settle(extra.id), 'confirmed');
    await query(`update tickets set status = 'refunded' where id = $1`, [extra.id]);

    const m = await panel(a, g.id);
    assert.equal(m.confirmed, '3');
    assert.equal(m.revenue, 'R$ 350,00');
    assert.equal(m.refunded, '1');
    assert.equal(m.pending, '0');
    assert.equal(m.available, '2'); // estornado não ocupa vaga (R05)
  });

  test('evento cancelado: Vagas disponíveis 0, estornados contados e receita sem eles', async () => {
    const a = await as(SEED.orgA);
    const e = await createEventRow({ capacity: 5 });
    const t1 = await buyPartner(e.id, '0001');
    const t2 = await buyPartner(e.id, '0004');
    assert.equal(await settle(t1.id), 'confirmed');
    await query(`update events set status = 'cancelled' where id = $1`, [e.id]);
    await query(`update tickets set status = 'refunded' where id = $1`, [t1.id]);
    await query(`update tickets set status = 'cancelled' where id = $1`, [t2.id]);
    assert.deepEqual(await panel(a, e.id), {
      confirmed: '0', pending: '0', checkins: '0', available: '0', revenue: 'R$ 0,00', refunded: '1',
    });
  });

  test('ACL-PANEL-01: B pela URL direta → 404 sem nome nem números; participante → 403', async () => {
    const b = await as(SEED.orgB);
    const p = await as(SEED.participant);
    const e = await createEventRow({ name: 'Show Secreto do A' });
    const t = await buyWeb(p, e.id, '0001');
    assert.equal(await settle(t.id), 'confirmed');
    const r = await b.get(`/organizer/events/${e.id}`);
    assert.equal(r.status, 404);
    assert.doesNotMatch(r.text, /Show Secreto do A|data-metric|data-section="panel"|R\$ 100,00/);
    assert.equal((await p.get(`/organizer/events/${e.id}`)).status, 403);
  });
});

describe('getPanelMetrics (serviço)', () => {
  test('mistura de status e canais, receita por price_cents do ingresso', async () => {
    const e = await createEventRow({ capacity: 10, priceCents: 10000 });
    const rows = [
      ['confirmed', 'web', 10000, true],
      ['confirmed', 'partner', 15000, false],
      ['pending', 'partner', 15000, false],
      ['declined', 'web', 10000, false],
      ['cancelled', 'partner', 10000, false],
      ['refunded', 'web', 20000, false],
    ];
    for (const [status, channel, price, checkedIn] of rows) {
      const t = await buyPartner(e.id, '0004');
      await query(
        'update tickets set status = $2, channel = $3, price_cents = $4, checked_in_at = $5 where id = $1',
        [t.id, status, channel, price, checkedIn ? new Date() : null],
      );
    }
    assert.deepEqual(await getPanelMetrics(e.id), {
      confirmed: 2, pending: 1, checkins: 1, available: 7, revenueCents: 25000, refunded: 1,
    });
  });
});
