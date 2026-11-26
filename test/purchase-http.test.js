import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb, query } from './helpers/db.js';
import { startTestServer } from './helpers/server.js';
import { createClient, SEED } from './helpers/client.js';
import { createEventRow, countTickets, card } from './helpers/fixtures.js';
import { toDateTimeLocal } from '../src/web/html.js';
import { centsToPriceInput } from '../src/events/page.js';

// Servidor com o worker do gateway ligado (GATEWAY_DELAY_SCALE=0.01 nos gates:
// 0001/0002 em 20–50 ms, 0003/0004 em 300–400 ms).
let server;
before(async () => {
  server = await startTestServer({ backgroundJobs: true });
});
after(async () => {
  await server.close();
  await closeDb();
});

const DAY = 24 * 60 * 60 * 1000;
let seq = 0;

async function as(email) {
  const c = createClient(server.baseUrl);
  await c.login(email);
  return c;
}

async function signup() {
  const c = createClient(server.baseUrl);
  seq += 1;
  const email = `p${seq}-${Date.now()}@exemplo.com`;
  const r = await c.postForm('/signup', { name: `Participante ${seq}`, email, password: 'senha-forte-123' });
  assert.equal(r.status, 302, r.text);
  return c;
}

function article(text, eventId) {
  const m = new RegExp(`<article class="event" data-event-id="${eventId}">([\\s\\S]*?)</article>`).exec(text);
  return m ? m[1] : null;
}

function rows(text) {
  return [...text.matchAll(/<tr data-ticket-code="([^"]+)" data-ticket-status="([^"]+)" data-event-id="([^"]+)">([\s\S]*?)<\/tr>/g)].map(
    (m) => ({ code: m[1], status: m[2], eventId: m[3], html: m[4] }),
  );
}

async function waitFor(fn, timeoutMs = 3000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v || Date.now() - t0 > timeoutMs) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
}

function editForm(event, overrides = {}) {
  return {
    name: event.name,
    startsAt: toDateTimeLocal(event.starts_at),
    venue: event.venue,
    capacity: String(event.capacity),
    price: centsToPriceInput(event.price_cents),
    ...overrides,
  };
}

const purchase = (client, eventId, last4 = '0001') =>
  client.postForm(`/events/${eventId}/purchase`, { cardNumber: card(last4) });

describe('compra na vitrine (HTTP)', () => {
  beforeEach(resetDb);

  test('PUB-BUY-01: rascunho não é comprável (404 "Evento indisponível"); publicado aparece com vagas e formulário', async () => {
    const a = await as(SEED.orgA);
    const next = toDateTimeLocal(new Date(Date.now() + 31 * DAY));
    const created = await a.postForm('/organizer/events', {
      name: 'Jazz no Porão', startsAt: next, venue: 'Bar do Zé', capacity: '2', price: '100,00',
    });
    assert.equal(created.status, 302);
    const id = created.location.split('/').pop();
    const p = await signup();
    assert.equal(article((await p.get('/')).text, id), null);
    const r = await purchase(p, id);
    assert.equal(r.status, 404);
    assert.match(r.text, /Evento indisponível/);
    assert.equal(await countTickets(), 0);

    assert.equal((await a.postForm(`/organizer/events/${id}/publish`)).status, 303);
    const card = article((await p.get('/')).text, id);
    assert.ok(card, 'evento na vitrine');
    assert.match(card, /Vagas disponíveis: 2/);
    assert.ok(card.includes(`<form method="post" action="/events/${id}/purchase"`));
    assert.match(card, /name="cardNumber"/);
    assert.match(card, /Comprar/);
  });

  test('BUY-WEB-01: compra responde 303 rápido, nasce pendente com código de 8 e confirma', async () => {
    const event = await createEventRow({ capacity: 2 });
    const p = await signup();
    const t0 = Date.now();
    const r = await purchase(p, event.id, '0003');
    assert.ok(Date.now() - t0 < 1000);
    assert.equal(r.status, 303);
    assert.equal(r.location, '/my-tickets');
    const first = await p.get('/my-tickets');
    assert.match(first.text, /Compra recebida, aguardando pagamento/);
    const [row] = rows(first.text);
    assert.equal(row.status, 'pending');
    assert.match(row.html, /pendente/);
    assert.match(row.code, /^[A-Z2-9]{8}$/);
    assert.equal(row.eventId, event.id);
    assert.match(row.html, /Evento teste/);
    const later = await waitFor(async () => {
      const [x] = rows((await p.get('/my-tickets')).text);
      return x.status === 'confirmed' ? x : null;
    });
    assert.ok(later, 'confirmado');
    assert.equal(later.code, row.code);
    assert.match(later.html, /confirmado/);
  });

  test('MY-TICKETS-01: cada participante vê só os próprios ingressos; vazio mostra aviso', async () => {
    const event = await createEventRow();
    const p1 = await signup();
    const p2 = await signup();
    const p3 = await signup();
    assert.equal((await purchase(p1, event.id)).status, 303);
    assert.equal((await purchase(p2, event.id)).status, 303);
    const r1 = rows((await p1.get('/my-tickets')).text);
    const r2 = rows((await p2.get('/my-tickets')).text);
    assert.equal(r1.length, 1);
    assert.equal(r2.length, 1);
    assert.notEqual(r1[0].code, r2[0].code);
    assert.match((await p3.get('/my-tickets')).text, /Você ainda não tem ingressos/);
  });

  test('VISITOR-01: visitante vê convite, sem formulário; POST → /login sem criar ingresso', async () => {
    const event = await createEventRow();
    const v = createClient(server.baseUrl);
    const card = article((await v.get('/')).text, event.id);
    assert.match(card, /Entre como participante para comprar/);
    assert.doesNotMatch(card, /<form/);
    assert.doesNotMatch(card, /cardNumber/);
    const r = await purchase(v, event.id);
    assert.equal(r.status, 302);
    assert.equal(r.location, '/login');
    assert.equal((await v.get('/my-tickets')).location, '/login');
    assert.equal(await countTickets(), 0);
  });

  test('organizador não vê formulário e não compra (403)', async () => {
    const event = await createEventRow();
    const a = await as(SEED.orgA);
    const card = article((await a.get('/')).text, event.id);
    assert.match(card, /Vagas disponíveis: 5/);
    assert.doesNotMatch(card, /<form/);
    assert.equal((await purchase(a, event.id)).status, 403);
    assert.equal((await a.get('/my-tickets')).status, 403);
    assert.equal(await countTickets(), 0);
  });

  test('SEAT-PENDING-01: pendente esgota a vitrine; recusa libera a vaga', async () => {
    const event = await createEventRow({ capacity: 1 });
    const p = await signup();
    assert.equal((await purchase(p, event.id, '0004')).status, 303);
    const card = article((await p.get('/')).text, event.id);
    assert.match(card, /Ingressos esgotados/);
    assert.match(card, /Vagas disponíveis: 0/);
    assert.doesNotMatch(card, /<form/);
    const declined = await waitFor(async () => {
      const [x] = rows((await p.get('/my-tickets')).text);
      return x.status === 'declined' ? x : null;
    });
    assert.ok(declined);
    assert.match(declined.html, /recusado/);
    const after = article((await p.get('/')).text, event.id);
    assert.match(after, /Vagas disponíveis: 1/);
    assert.ok(after.includes(`action="/events/${event.id}/purchase"`));
    assert.doesNotMatch(after, /Ingressos esgotados/);
  });

  test('SOLDOUT-WEB-01: tentativa sem vaga → 409 "Ingressos esgotados"', async () => {
    const event = await createEventRow({ capacity: 1 });
    const a = await signup();
    const b = await signup();
    await b.get('/'); // página aberta antes
    assert.equal((await purchase(a, event.id, '0003')).status, 303);
    const r = await purchase(b, event.id);
    assert.equal(r.status, 409);
    assert.match(r.text, /Ingressos esgotados/);
    assert.match(article((await b.get('/')).text, event.id), /Ingressos esgotados/);
    assert.equal(await countTickets(event.id), 1);
  });

  test('CARD-INVALID-01: cartão sem 16 dígitos → 422 sem criar ingresso', async () => {
    const event = await createEventRow();
    const p = await signup();
    for (const cardNumber of ['123', '40000000000000012', '', '4000-0000-0000-0001']) {
      const r = await p.postForm(`/events/${event.id}/purchase`, { cardNumber });
      assert.equal(r.status, 422, cardNumber);
      assert.match(r.text, /O número do cartão deve ter 16 dígitos/);
    }
    const r = await p.postForm(`/events/${event.id}/purchase`, {});
    assert.equal(r.status, 422);
    // cartão inválido em evento inexistente → 422 (validação antes do evento)
    assert.equal((await p.postForm('/events/evt_naoexiste00/purchase', { cardNumber: '1' })).status, 422);
    assert.equal((await purchase(p, 'evt_naoexiste00')).status, 404);
    assert.equal(await countTickets(), 0);
  });

  test('evento cancelado: some da vitrine e compra → 404', async () => {
    const event = await createEventRow({ status: 'cancelled' });
    const p = await signup();
    assert.equal(article((await p.get('/')).text, event.id), null);
    const r = await purchase(p, event.id);
    assert.equal(r.status, 404);
    assert.match(r.text, /Evento indisponível/);
  });

  test('PRICE-SNAPSHOT-01: mudança de preço na gestão vale só para compras posteriores', async () => {
    const event = await createEventRow({ priceCents: 10000 });
    const p = await signup();
    const a = await as(SEED.orgA);
    assert.equal((await purchase(p, event.id)).status, 303);
    assert.equal((await a.postForm(`/organizer/events/${event.id}`, editForm(event, { price: '150,00' }))).status, 303);
    assert.equal((await purchase(p, event.id)).status, 303);
    const { rows: t } = await query('select price_cents from tickets where event_id = $1 order by created_at', [event.id]);
    assert.deepEqual(t.map((x) => x.price_cents), [10000, 15000]);
  });

  test('CAP-EDIT-01: lotação abaixo das ocupadas → 422; aumentar → vitrine mostra a vaga nova', async () => {
    const event = await createEventRow({ capacity: 2 });
    const p = await signup();
    await purchase(p, event.id, '0003');
    await purchase(p, event.id, '0001');
    const a = await as(SEED.orgA);
    const r1 = await a.postForm(`/organizer/events/${event.id}`, editForm(event, { capacity: '1' }));
    assert.equal(r1.status, 422);
    assert.match(r1.text, /A lotação não pode ser menor que as vagas ocupadas \(2\)/);
    const r2 = await a.postForm(`/organizer/events/${event.id}`, editForm(event, { capacity: '3' }));
    assert.equal(r2.status, 303);
    assert.match(article((await p.get('/')).text, event.id), /Vagas disponíveis: 1/);
  });

  test('CONC-01 (HTTP): 30 POSTs simultâneos em lotação 5 → 5×303 e 25×409, 2 rodadas', async () => {
    const p = await signup();
    for (let round = 0; round < 2; round++) {
      const event = await createEventRow({ capacity: 5 });
      const res = await Promise.all(Array.from({ length: 30 }, () => purchase(p, event.id)));
      const statuses = res.map((r) => r.status);
      assert.equal(statuses.filter((s) => s === 303).length, 5, statuses.join(','));
      assert.equal(statuses.filter((s) => s === 409).length, 25, statuses.join(','));
      const { rows: n } = await query(
        "select count(*)::int as n from tickets where event_id = $1 and status in ('pending','confirmed')",
        [event.id],
      );
      assert.equal(n[0].n, 5);
    }
  });
});
