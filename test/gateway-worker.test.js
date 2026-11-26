import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb, query } from './helpers/db.js';
import { createEventRow, card } from './helpers/fixtures.js';
import { purchaseTicket } from '../src/tickets/purchase.js';
import { getAvailability } from '../src/tickets/availability.js';
import { getTicketById } from '../src/tickets/repo.js';
import { processDueAttempts, startGatewayWorker, stopGatewayWorker } from '../src/gateway/worker.js';
import { listBackgroundJobs } from '../src/background.js';

before(resetDb);
after(closeDb);

const buy = (eventId, last4) =>
  purchaseTicket({ eventId, buyerEmail: 'w@exemplo.com', cardNumber: card(last4), channel: 'web' });

async function makeDue(ticketId) {
  await query("update payment_attempts set respond_at = now() - interval '1 second' where ticket_id = $1", [ticketId]);
}

async function attemptOf(ticketId) {
  const { rows } = await query('select * from payment_attempts where ticket_id = $1', [ticketId]);
  return rows[0];
}

async function waitFor(fn, { timeoutMs = 3000, stepMs = 20 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) return v;
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

describe('processDueAttempts', () => {
  beforeEach(resetDb);

  test('worker registrado como background job', () => {
    assert.ok(listBackgroundJobs().includes('gateway-worker'));
  });

  test('aprovado (0001) → confirmed e processed_at marcado', async () => {
    const event = await createEventRow();
    const { ticket } = await buy(event.id, '0001');
    await makeDue(ticket.id);
    assert.equal(await processDueAttempts(), 1);
    assert.equal((await getTicketById(ticket.id)).status, 'confirmed');
    assert.ok((await attemptOf(ticket.id)).processed_at);
    assert.equal(await processDueAttempts(), 0, 'não processa duas vezes');
  });

  test('recusado (0002, 0004, outro final) → declined e libera a vaga', async () => {
    for (const last4 of ['0002', '0004', '9999']) {
      const event = await createEventRow({ capacity: 1 });
      const { ticket } = await buy(event.id, last4);
      assert.equal((await getAvailability(event.id)).available, 0, 'pendente ocupa vaga');
      assert.equal((await buy(event.id, '0001')).error, 'sold_out');
      await makeDue(ticket.id);
      await processDueAttempts();
      assert.equal((await getTicketById(ticket.id)).status, 'declined', last4);
      assert.equal((await getAvailability(event.id)).available, 1, 'recusa libera vaga');
      assert.equal((await buy(event.id, '0001')).ok, true);
    }
  });

  test('tentativa ainda não vencida não é processada', async () => {
    const event = await createEventRow();
    const { ticket } = await buy(event.id, '0003');
    await query("update payment_attempts set respond_at = now() + interval '1 hour' where ticket_id = $1", [ticket.id]);
    assert.equal(await processDueAttempts(), 0);
    assert.equal((await getTicketById(ticket.id)).status, 'pending');
    assert.equal((await attemptOf(ticket.id)).processed_at, null);
  });

  test('resposta tardia: ingresso cancelado/estornado antes do processamento não muda (guarda pending)', async () => {
    const event = await createEventRow();
    const a = await buy(event.id, '0001');
    const b = await buy(event.id, '0002');
    await query("update tickets set status = 'cancelled' where id = $1", [a.ticket.id]);
    await query("update tickets set status = 'refunded' where id = $1", [b.ticket.id]);
    await makeDue(a.ticket.id);
    await makeDue(b.ticket.id);
    assert.equal(await processDueAttempts(), 2);
    assert.equal((await getTicketById(a.ticket.id)).status, 'cancelled');
    assert.equal((await getTicketById(b.ticket.id)).status, 'refunded');
    assert.ok((await attemptOf(a.ticket.id)).processed_at, 'processed_at marcado mesmo sem mudar o ingresso');
    assert.ok((await attemptOf(b.ticket.id)).processed_at);
  });

  test('chamadas concorrentes (SKIP LOCKED) processam cada tentativa uma única vez', async () => {
    const event = await createEventRow({ capacity: 40 });
    for (let i = 0; i < 30; i++) await buy(event.id, i % 2 ? '0001' : '0002');
    await query("update payment_attempts set respond_at = now() - interval '1 second'");
    const counts = await Promise.all(Array.from({ length: 6 }, () => processDueAttempts({ limit: 7 })));
    let total = counts.reduce((s, n) => s + n, 0);
    while (total < 30) {
      const n = await processDueAttempts();
      if (!n) break;
      total += n;
    }
    assert.equal(total, 30);
    const { rows } = await query(
      "select count(*) filter (where status = 'confirmed')::int as c, count(*) filter (where status = 'declined')::int as d from tickets",
    );
    assert.deepEqual(rows[0], { c: 15, d: 15 });
  });
});

describe('worker em execução (GATEWAY_DELAY_SCALE dos gates)', () => {
  beforeEach(resetDb);
  afterEach(stopGatewayWorker);

  test('intervalo: compra 0001 vira confirmed e 0002 vira declined sem chamada manual', async () => {
    startGatewayWorker();
    const event = await createEventRow();
    const ok = await buy(event.id, '0001');
    const no = await buy(event.id, '0002');
    assert.equal(ok.ticket.status, 'pending');
    const done = await waitFor(async () => {
      const [x, y] = [await getTicketById(ok.ticket.id), await getTicketById(no.ticket.id)];
      return x.status !== 'pending' && y.status !== 'pending' ? [x, y] : null;
    });
    assert.ok(done, 'worker processou');
    assert.equal(done[0].status, 'confirmed');
    assert.equal(done[1].status, 'declined');
  });

  test('setTimeout no respond_at processa mesmo com intervalo longo', async () => {
    startGatewayWorker({ intervalMs: 60_000 });
    await new Promise((r) => setTimeout(r, 50)); // passa a rodada inicial
    const event = await createEventRow();
    const { ticket } = await buy(event.id, '0003'); // 300–400 ms com escala 0.01
    const t = await waitFor(async () => {
      const row = await getTicketById(ticket.id);
      return row.status === 'confirmed' ? row : null;
    });
    assert.ok(t, 'confirmado pelo timer de respond_at');
  });

  test('reinício: resposta vencida com o worker parado é aplicada ao iniciar', async () => {
    const event = await createEventRow();
    const { ticket } = await buy(event.id, '0001');
    await makeDue(ticket.id);
    startGatewayWorker({ intervalMs: 60_000 });
    const t = await waitFor(async () => ((await getTicketById(ticket.id)).status === 'confirmed' ? true : null));
    assert.ok(t);
  });
});
