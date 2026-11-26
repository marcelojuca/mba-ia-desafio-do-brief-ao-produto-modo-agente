import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb, query } from './helpers/db.js';
import { createEventRow, userIdByEmail } from './helpers/fixtures.js';
import { buyWeb, buyPartner, settle } from './helpers/tickets-control.js';
import { createClient, SEED } from './helpers/client.js';
import { startTestServer } from './helpers/server.js';
import { newId } from '../src/ids.js';
import { generateTicketCode } from '../src/tickets/code.js';
import { checkIn, normalizeCode, CHECKIN_MESSAGES } from '../src/checkin/service.js';

after(closeDb);

// Ingresso direto no banco, em qualquer status (estados de F06 montados à mão).
async function ticketRow(eventId, { status = 'confirmed', checkedIn = false, channel = 'web', priceCents = 10000 } = {}) {
  const userId = await userIdByEmail(SEED.participant);
  const { rows } = await query(
    `insert into tickets (id, event_id, user_id, buyer_email, code, status, price_cents, channel, checked_in_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
    [newId('tkt'), eventId, userId, SEED.participant, generateTicketCode(), status, priceCents, channel,
      checkedIn ? new Date() : null],
  );
  return rows[0];
}

describe('checkIn (serviço, R10)', () => {
  beforeEach(resetDb);

  test('normalizeCode: trim + maiúsculas', () => {
    assert.equal(normalizeCode('  abcd2345 \n'), 'ABCD2345');
    assert.equal(normalizeCode(undefined), '');
  });

  test('confirmado sem check-in → Entrada liberada e grava checked_in_at; de novo → Ingresso já utilizado', async () => {
    const e = await createEventRow();
    const t = await ticketRow(e.id);
    assert.deepEqual(await checkIn(e.id, t.code), { key: 'ok', message: 'Entrada liberada' });
    const { rows } = await query('select checked_in_at, status from tickets where id = $1', [t.id]);
    assert.ok(rows[0].checked_in_at);
    assert.equal(rows[0].status, 'confirmed');
    assert.deepEqual(await checkIn(e.id, t.code), { key: 'already_used', message: 'Ingresso já utilizado' });
  });

  test('código minúsculo com espaços é normalizado', async () => {
    const e = await createEventRow();
    const t = await ticketRow(e.id);
    assert.equal((await checkIn(e.id, `  ${t.code.toLowerCase()}  `)).message, 'Entrada liberada');
  });

  test('pendente, recusado, cancelado e estornado → Ingresso não confirmado', async () => {
    const e = await createEventRow({ capacity: 10 });
    for (const status of ['pending', 'declined', 'cancelled', 'refunded']) {
      const t = await ticketRow(e.id, { status });
      assert.equal((await checkIn(e.id, t.code)).message, 'Ingresso não confirmado', status);
    }
  });

  test('código inexistente, vazio e de outro evento → Ingresso inválido para este evento', async () => {
    const e = await createEventRow();
    const other = await createEventRow({ organizerEmail: SEED.orgB });
    const t = await ticketRow(other.id);
    assert.equal((await checkIn(e.id, 'ZZZZZZZZ')).message, CHECKIN_MESSAGES.invalid);
    assert.equal((await checkIn(e.id, '   ')).message, CHECKIN_MESSAGES.invalid);
    assert.equal((await checkIn(e.id, t.code)).message, CHECKIN_MESSAGES.invalid);
    const { rows } = await query('select checked_in_at from tickets where id = $1', [t.id]);
    assert.equal(rows[0].checked_in_at, null);
  });

  test('evento cancelado tem precedência sobre não confirmado e já utilizado; inexistente continua inválido', async () => {
    const e = await createEventRow();
    const used = await ticketRow(e.id, { checkedIn: true });
    const fresh = await ticketRow(e.id);
    const refunded = await ticketRow(e.id, { status: 'refunded' });
    await query(`update events set status = 'cancelled' where id = $1`, [e.id]);
    assert.equal((await checkIn(e.id, used.code)).message, 'Evento cancelado');
    assert.equal((await checkIn(e.id, fresh.code)).message, 'Evento cancelado');
    assert.equal((await checkIn(e.id, refunded.code)).message, 'Evento cancelado');
    assert.equal((await checkIn(e.id, 'ZZZZZZZZ')).message, 'Ingresso inválido para este evento');
    const { rows } = await query('select checked_in_at from tickets where id = $1', [fresh.id]);
    assert.equal(rows[0].checked_in_at, null);
  });

  test('10 check-ins simultâneos do mesmo código → exatamente 1 Entrada liberada', async () => {
    const e = await createEventRow();
    const t = await ticketRow(e.id);
    const results = await Promise.all(Array.from({ length: 10 }, () => checkIn(e.id, t.code)));
    const keys = results.map((r) => r.key);
    assert.equal(keys.filter((k) => k === 'ok').length, 1);
    assert.equal(keys.filter((k) => k === 'already_used').length, 9);
  });
});

// ---------------------------------------------------------------------------
// HTTP: POST /organizer/events/:id/checkin (contrato F05). Servidor sem worker: o gateway é liquidado
// de forma determinística por settle() (test/helpers/tickets-control.js).

describe('check-in (HTTP)', () => {
  let server;
  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    await server.close();
  });
  beforeEach(resetDb);

  async function as(email) {
    const c = createClient(server.baseUrl);
    await c.login(email);
    return c;
  }

  function result(text) {
    const all = [...text.matchAll(/<p class="[^"]*" data-checkin-result="([^"]+)">([^<]*)<\/p>/g)];
    assert.equal(all.length, 1, 'um único resultado de check-in na página');
    return { key: all[0][1], message: all[0][2] };
  }

  const post = (client, eventId, code) => client.postForm(`/organizer/events/${eventId}/checkin`, { code });

  test('seção de check-in na página de gestão (também em evento cancelado)', async () => {
    const a = await as(SEED.orgA);
    const e = await createEventRow();
    let page = await a.get(`/organizer/events/${e.id}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /<section data-section="checkin">/);
    assert.match(page.text, new RegExp(`action="/organizer/events/${e.id}/checkin" data-form="checkin"`));
    assert.match(page.text, /name="code"/);
    assert.match(page.text, /Validar ingresso/);
    assert.doesNotMatch(page.text, /data-checkin-result/);
    await query(`update events set status = 'cancelled' where id = $1`, [e.id]);
    page = await a.get(`/organizer/events/${e.id}`);
    assert.match(page.text, /data-form="checkin"/);
  });

  test('CHK-OK-01 / CHK-USED-01 / CHK-NOTCONF-01 / CHK-INVALID-01 / CHK-OTHER-EVENT-01 (canais web e partner)', async () => {
    const a = await as(SEED.orgA);
    const b = await as(SEED.orgB);
    const p = await as(SEED.participant);
    const e = await createEventRow({ capacity: 3 });

    const c1 = await buyWeb(p, e.id, '0001');
    assert.equal(await settle(c1.id), 'confirmed');
    const c2 = await buyPartner(e.id, '0004'); // pendente
    const c1b = await buyPartner(e.id, '0003');
    assert.equal(await settle(c1b.id), 'confirmed');

    let r = await post(a, e.id, c1.code);
    assert.equal(r.status, 200);
    assert.deepEqual(result(r.text), { key: 'ok', message: 'Entrada liberada' });
    // minúsculo com espaços (ingresso do canal partner)
    r = await post(a, e.id, `  ${c1b.code.toLowerCase()}  `);
    assert.deepEqual(result(r.text), { key: 'ok', message: 'Entrada liberada' });

    r = await post(a, e.id, c1.code);
    assert.equal(r.status, 200);
    assert.deepEqual(result(r.text), { key: 'already_used', message: 'Ingresso já utilizado' });

    r = await post(a, e.id, c2.code);
    assert.deepEqual(result(r.text), { key: 'not_confirmed', message: 'Ingresso não confirmado' });
    assert.equal(await settle(c2.id), 'declined');
    r = await post(a, e.id, c2.code);
    assert.deepEqual(result(r.text), { key: 'not_confirmed', message: 'Ingresso não confirmado' });

    r = await post(a, e.id, 'ZZZZZZZZ');
    assert.deepEqual(result(r.text), { key: 'invalid', message: 'Ingresso inválido para este evento' });

    // evento de outro organizador, ingresso confirmado
    const e2 = await createEventRow({ organizerEmail: SEED.orgB });
    const c3 = await buyWeb(p, e2.id, '0001');
    assert.equal(await settle(c3.id), 'confirmed');
    r = await post(a, e.id, c3.code);
    assert.deepEqual(result(r.text), { key: 'invalid', message: 'Ingresso inválido para este evento' });
    // B ainda consegue usar C3 no próprio evento
    r = await post(b, e2.id, c3.code);
    assert.deepEqual(result(r.text), { key: 'ok', message: 'Entrada liberada' });
  });

  test('CHK-CANCELLED-01: evento cancelado tem precedência; inexistente continua inválido', async () => {
    const a = await as(SEED.orgA);
    const p = await as(SEED.participant);
    const f = await createEventRow();
    const c4 = await buyWeb(p, f.id, '0001');
    const c5 = await buyPartner(f.id, '0001');
    const pending = await buyPartner(f.id, '0004');
    assert.equal(await settle(c4.id), 'confirmed');
    assert.equal(await settle(c5.id), 'confirmed');
    assert.deepEqual(result((await post(a, f.id, c4.code)).text).key, 'ok');

    await query(`update events set status = 'cancelled' where id = $1`, [f.id]);
    for (const code of [c4.code, c5.code, pending.code]) {
      const r = await post(a, f.id, code);
      assert.equal(r.status, 200);
      assert.deepEqual(result(r.text), { key: 'event_cancelled', message: 'Evento cancelado' });
    }
    const r = await post(a, f.id, 'ZZZZZZZZ');
    assert.deepEqual(result(r.text), { key: 'invalid', message: 'Ingresso inválido para este evento' });
    const { rows } = await query('select checked_in_at from tickets where id = $1', [c5.id]);
    assert.equal(rows[0].checked_in_at, null);
  });

  test('CHK-CONC-01: 10 POSTs simultâneos do mesmo código → 1 "Entrada liberada" e 9 "Ingresso já utilizado"', async () => {
    const a = await as(SEED.orgA);
    const p = await as(SEED.participant);
    const e = await createEventRow();
    const t = await buyWeb(p, e.id, '0001');
    assert.equal(await settle(t.id), 'confirmed');
    const responses = await Promise.all(Array.from({ length: 10 }, () => post(a, e.id, t.code)));
    assert.ok(responses.every((r) => r.status === 200));
    const msgs = responses.map((r) => result(r.text).message);
    assert.equal(msgs.filter((m) => m === 'Entrada liberada').length, 1, msgs.join(' | '));
    assert.equal(msgs.filter((m) => m === 'Ingresso já utilizado').length, 9, msgs.join(' | '));
  });

  test('ACL-PANEL-01 (check-in): B → 404 sem dados e sem check-in; participante → 403; visitante → /login', async () => {
    const a = await as(SEED.orgA);
    const b = await as(SEED.orgB);
    const p = await as(SEED.participant);
    const e = await createEventRow({ name: 'Show Secreto do A' });
    const t = await buyWeb(p, e.id, '0001');
    assert.equal(await settle(t.id), 'confirmed');

    let r = await post(b, e.id, t.code);
    assert.equal(r.status, 404);
    assert.doesNotMatch(r.text, /Show Secreto do A/);
    assert.doesNotMatch(r.text, /data-checkin-result|data-metric/);
    const { rows } = await query('select checked_in_at from tickets where id = $1', [t.id]);
    assert.equal(rows[0].checked_in_at, null);

    r = await post(p, e.id, t.code);
    assert.equal(r.status, 403);
    r = await post(createClient(server.baseUrl), e.id, t.code);
    assert.equal(r.status, 302);
    assert.equal(r.location, '/login');

    r = await post(a, e.id, t.code);
    assert.deepEqual(result(r.text), { key: 'ok', message: 'Entrada liberada' });
  });
});
