import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb, query, pool } from './helpers/db.js';
import { createEventRow, ticketsOf, countTickets, userIdByEmail, card } from './helpers/fixtures.js';
import { SEED, createClient } from './helpers/client.js';
import { startTestServer } from './helpers/server.js';
import { toDateTimeLocal } from '../src/web/html.js';
import { centsToPriceInput } from '../src/events/page.js';
import { cancelEvent } from '../src/cancellation/service.js';
import { purchaseTicket } from '../src/tickets/purchase.js';
import { getAvailability } from '../src/tickets/availability.js';
import { getTicketById } from '../src/tickets/repo.js';
import { processDueAttempts } from '../src/gateway/worker.js';

// F06 — cancelamento de evento. O worker do gateway NÃO roda em background aqui: as respostas são aplicadas
// chamando processDueAttempts() (determinístico).

before(resetDb);
after(closeDb);

const buy = (eventId, last4, channel = 'web') =>
  purchaseTicket({ eventId, buyerEmail: 'comprador@exemplo.com', cardNumber: card(last4), channel });

async function makeDue(ticketId) {
  await query("update payment_attempts set respond_at = now() - interval '1 second' where ticket_id = $1", [ticketId]);
}

async function attemptOf(ticketId) {
  const { rows } = await query('select * from payment_attempts where ticket_id = $1', [ticketId]);
  return rows[0];
}

async function eventRow(id) {
  const { rows } = await query('select * from events where id = $1', [id]);
  return rows[0];
}

describe('cancelEvent (serviço)', () => {
  let orgA;
  let orgB;
  beforeEach(async () => {
    await resetDb();
    orgA = await userIdByEmail(SEED.orgA);
    orgB = await userIdByEmail(SEED.orgB);
  });

  test('só publicado cancela: rascunho e já cancelado → not_cancellable, sem mudanças', async () => {
    const draft = await createEventRow({ status: 'draft' });
    const r1 = await cancelEvent(draft.id, orgA);
    assert.equal(r1.ok, false);
    assert.equal(r1.error, 'not_cancellable');
    assert.equal((await eventRow(draft.id)).status, 'draft');
    assert.equal((await eventRow(draft.id)).cancelled_at, null);

    const pub = await createEventRow();
    assert.equal((await cancelEvent(pub.id, orgA)).ok, true);
    const before = await eventRow(pub.id);
    const r2 = await cancelEvent(pub.id, orgA);
    assert.equal(r2.error, 'not_cancellable');
    assert.deepEqual(await eventRow(pub.id), before, 'segundo cancelamento não altera nada');
  });

  test('evento de outro organizador ou inexistente → not_found; continua publicado', async () => {
    const pub = await createEventRow();
    assert.deepEqual(await cancelEvent(pub.id, orgB), { ok: false, error: 'not_found' });
    assert.deepEqual(await cancelEvent('evt_naoexiste00', orgA), { ok: false, error: 'not_found' });
    assert.equal((await eventRow(pub.id)).status, 'published');
  });

  test('transições: confirmed → refunded, pending → cancelled, declined não muda; cancelled_at preenchido', async () => {
    const event = await createEventRow({ capacity: 10, priceCents: 5000 });
    const confirmedWeb = await buy(event.id, '0001');
    const confirmedPartner = await buy(event.id, '0001', 'partner');
    const declined = await buy(event.id, '0002');
    const pending = await buy(event.id, '0003');
    const pendingPartner = await buy(event.id, '0003', 'partner');
    for (const r of [confirmedWeb, confirmedPartner, declined]) await makeDue(r.ticket.id);
    assert.equal(await processDueAttempts(), 3);

    const result = await cancelEvent(event.id, orgA);
    assert.equal(result.ok, true);
    assert.equal(result.refunded, 2);
    assert.equal(result.cancelled, 2);
    assert.equal(result.event.status, 'cancelled');
    assert.ok(result.event.cancelled_at instanceof Date);

    const status = async (r) => (await getTicketById(r.ticket.id)).status;
    assert.equal(await status(confirmedWeb), 'refunded');
    assert.equal(await status(confirmedPartner), 'refunded');
    assert.equal(await status(declined), 'declined');
    assert.equal(await status(pending), 'cancelled');
    assert.equal(await status(pendingPartner), 'cancelled');
    const row = await eventRow(event.id);
    assert.equal(row.status, 'cancelled');
    assert.ok(row.cancelled_at);
  });

  test('resposta tardia do gateway (aprovada e recusada) não altera ingressos cancelados; processed_at marcado', async () => {
    const event = await createEventRow();
    const approved = await buy(event.id, '0003'); // aprovaria
    const refused = await buy(event.id, '0004'); // recusaria
    const confirmed = await buy(event.id, '0001');
    await makeDue(confirmed.ticket.id);
    await processDueAttempts();

    assert.equal((await cancelEvent(event.id, orgA)).ok, true);
    await makeDue(approved.ticket.id);
    await makeDue(refused.ticket.id);
    assert.equal(await processDueAttempts(), 2, 'o worker processa as tentativas tardias');

    assert.equal((await getTicketById(approved.ticket.id)).status, 'cancelled');
    assert.equal((await getTicketById(refused.ticket.id)).status, 'cancelled');
    assert.equal((await getTicketById(confirmed.ticket.id)).status, 'refunded');
    assert.ok((await attemptOf(approved.ticket.id)).processed_at);
    assert.ok((await attemptOf(refused.ticket.id)).processed_at);
  });

  test('depois de cancelado: compra → event_not_available (web e partner), nenhum ingresso novo, vagas = 0', async () => {
    const event = await createEventRow({ capacity: 5 });
    await buy(event.id, '0003');
    assert.equal((await getAvailability(event.id)).available, 4);
    await cancelEvent(event.id, orgA);
    const n = await countTickets(event.id);
    assert.deepEqual(await buy(event.id, '0001'), { ok: false, error: 'event_not_available' });
    assert.deepEqual(await buy(event.id, '0001', 'partner'), { ok: false, error: 'event_not_available' });
    assert.equal(await countTickets(event.id), n);
    const av = await getAvailability(event.id);
    assert.equal(av.available, 0);
    assert.equal(av.occupied, 0);
  });

  test('worker segurando o lock do ingresso (pending → confirmed): o UPDATE único reavalia e estorna', async () => {
    const event = await createEventRow();
    const { ticket } = await buy(event.id, '0001');
    // Simula o worker no meio da transação: confirmou o ingresso, ainda não fez COMMIT.
    const worker = await pool.connect();
    try {
      await worker.query('BEGIN');
      await worker.query("update tickets set status = 'confirmed', updated_at = now() where id = $1 and status = 'pending'", [
        ticket.id,
      ]);
      const cancelling = cancelEvent(event.id, orgA); // bloqueia no lock da linha do ingresso
      await new Promise((r) => setTimeout(r, 150));
      await worker.query('COMMIT');
      const result = await cancelling;
      assert.equal(result.ok, true);
      assert.equal(result.refunded, 1);
      assert.equal(result.cancelled, 0);
    } finally {
      worker.release();
    }
    assert.equal((await getTicketById(ticket.id)).status, 'refunded');
  });

  test('corrida worker (aprovação) × cancelamento, 20×: nunca sobra pending/confirmed', async () => {
    const outcomes = { refunded: 0, cancelled: 0 };
    for (let i = 0; i < 20; i++) {
      const event = await createEventRow({ capacity: 6 });
      const ids = [];
      for (let k = 0; k < 6; k++) ids.push((await buy(event.id, '0001', k % 2 ? 'partner' : 'web')).ticket.id);
      await query("update payment_attempts set respond_at = now() - interval '1 second' where ticket_id = any($1)", [ids]);

      const [, result] = await Promise.all([processDueAttempts(), cancelEvent(event.id, orgA)]);
      assert.equal(result.ok, true);
      await processDueAttempts(); // o que sobrou (resposta tardia)

      const tickets = await ticketsOf(event.id);
      for (const t of tickets) {
        assert.ok(['refunded', 'cancelled'].includes(t.status), `iteração ${i}: ${t.id} ficou ${t.status}`);
        outcomes[t.status] += 1;
        assert.ok((await attemptOf(t.id)).processed_at, 'toda tentativa foi processada');
      }
      assert.equal((await eventRow(event.id)).status, 'cancelled');
      assert.equal((await getAvailability(event.id)).available, 0);
    }
    assert.equal(outcomes.refunded + outcomes.cancelled, 120);
  });
});

describe('cancelamento pela página de gestão (HTTP)', () => {
  let server;
  before(async () => {
    server = await startTestServer(); // sem worker em background: respostas via processDueAttempts()
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

  let seq = 0;
  async function signup() {
    const c = createClient(server.baseUrl);
    seq += 1;
    const r = await c.postForm('/signup', {
      name: `Participante ${seq}`,
      email: `canc${seq}-${Date.now()}@exemplo.com`,
      password: 'senha-forte-123',
    });
    assert.equal(r.status, 302, r.text);
    return c;
  }

  const hasCancelButton = (text) => /data-form="cancel-event"/.test(text) || /Cancelar evento<\/button>/.test(text);
  const showcaseHas = (text, id) => text.includes(`data-event-id="${id}"`);

  function editForm(event) {
    return {
      name: event.name,
      startsAt: toDateTimeLocal(event.starts_at),
      venue: event.venue,
      capacity: String(event.capacity),
      price: centsToPriceInput(event.price_cents),
    };
  }

  function myTicketRows(text) {
    return [...text.matchAll(/<tr data-ticket-code="([^"]+)" data-ticket-status="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => ({
      code: m[1],
      status: m[2],
      html: m[3],
    }));
  }

  test('CAN-ONLY-PUBLISHED-01: rascunho não mostra "Cancelar evento"; POST → 409 e continua rascunho', async () => {
    const a = await as(SEED.orgA);
    const draft = await createEventRow({ status: 'draft' });
    const page = await a.get(`/organizer/events/${draft.id}`);
    assert.equal(page.status, 200);
    assert.ok(!hasCancelButton(page.text));
    assert.ok(!page.text.includes('data-section="cancel"'));

    const r = await a.postForm(`/organizer/events/${draft.id}/cancel`);
    assert.equal(r.status, 409);
    assert.match(r.text, /Só eventos publicados podem ser cancelados/);
    assert.equal((await eventRow(draft.id)).status, 'draft');
  });

  test('CAN-TRANSITIONS-01: página publicada tem o botão (sem confirm em JS); POST → 303, aviso "Evento cancelado", transições', async () => {
    const a = await as(SEED.orgA);
    const p = await signup();
    const event = await createEventRow({ capacity: 5, priceCents: 5000 });

    const page = await a.get(`/organizer/events/${event.id}`);
    assert.ok(hasCancelButton(page.text));
    assert.match(page.text, /irreversível/);
    assert.ok(!/confirm\(/.test(page.text), 'sem confirm() em JS');

    const pendingBuy = await p.postForm(`/events/${event.id}/purchase`, { cardNumber: card('0003') });
    assert.equal(pendingBuy.status, 303);
    const webConfirmed = await p.postForm(`/events/${event.id}/purchase`, { cardNumber: card('0001') });
    assert.equal(webConfirmed.status, 303);
    const partner = await buy(event.id, '0001', 'partner');
    const webTicket = async (last4) => {
      const { rows } = await query(
        `select t.* from tickets t join payment_attempts a on a.ticket_id = t.id
          where t.event_id = $1 and t.channel = 'web' and a.card_last4 = $2`,
        [event.id, last4],
      );
      assert.equal(rows.length, 1);
      return rows[0];
    };
    const pendingT = await webTicket('0003');
    const confirmedWeb = await webTicket('0001');
    await makeDue(confirmedWeb.id);
    await makeDue(partner.ticket.id);
    assert.equal(await processDueAttempts(), 2);
    assert.equal((await getTicketById(partner.ticket.id)).status, 'confirmed');
    assert.equal((await getTicketById(pendingT.id)).status, 'pending');

    const r = await a.postForm(`/organizer/events/${event.id}/cancel`);
    assert.equal(r.status, 303);
    assert.equal(r.location, `/organizer/events/${event.id}`);
    const after = await a.get(r.location);
    assert.equal(after.status, 200);
    assert.match(after.text, /<p[^>]*data-notice[^>]*>Evento cancelado<\/p>/);
    assert.match(after.text, /data-event-status="cancelled"/);
    assert.match(after.text, /Evento cancelado em \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);

    assert.equal((await getTicketById(partner.ticket.id)).status, 'refunded');
    assert.equal((await getTicketById(confirmedWeb.id)).status, 'refunded');
    assert.equal((await getTicketById(pendingT.id)).status, 'cancelled');

    const mine = myTicketRows((await p.get('/my-tickets')).text);
    const byCode = new Map(mine.map((row) => [row.code, row]));
    assert.equal(byCode.get(confirmedWeb.code).status, 'refunded');
    assert.match(byCode.get(confirmedWeb.code).html, /estornado/);
    assert.equal(byCode.get(pendingT.code).status, 'cancelled');
    assert.match(byCode.get(pendingT.code).html, /cancelado/);

    // CAN-LATE-GW-01: a resposta do 0003 chega depois — nada muda, processed_at marcado.
    await makeDue(pendingT.id);
    assert.equal(await processDueAttempts(), 1);
    assert.equal((await getTicketById(pendingT.id)).status, 'cancelled');
    assert.equal((await getTicketById(partner.ticket.id)).status, 'refunded');
    assert.ok((await attemptOf(pendingT.id)).processed_at);
  });

  test('CAN-SHOWCASE-01: cancelado sai da vitrine; compra → 404 "Evento indisponível" sem ingresso novo; vagas 0', async () => {
    const a = await as(SEED.orgA);
    const p = await signup();
    const event = await createEventRow();
    const visitor = createClient(server.baseUrl);
    assert.ok(showcaseHas((await visitor.get('/')).text, event.id));

    assert.equal((await a.postForm(`/organizer/events/${event.id}/cancel`)).status, 303);
    assert.ok(!showcaseHas((await visitor.get('/')).text, event.id));
    assert.ok(!showcaseHas((await p.get('/')).text, event.id));

    const n = await countTickets();
    const r = await p.postForm(`/events/${event.id}/purchase`, { cardNumber: card('0001') });
    assert.equal(r.status, 404);
    assert.match(r.text, /Evento indisponível/);
    assert.equal(await countTickets(), n);
    assert.equal((await getAvailability(event.id)).available, 0);
  });

  test('CAN-LOCK-EDIT-01: cancelado não tem edição/publicar/cancelar; edição, publicação e novo cancelamento → 409 sem mudanças', async () => {
    const a = await as(SEED.orgA);
    const event = await createEventRow();
    assert.equal((await a.postForm(`/organizer/events/${event.id}/cancel`)).status, 303);
    const snapshot = await eventRow(event.id);

    const page = await a.get(`/organizer/events/${event.id}`);
    assert.equal(page.status, 200);
    assert.ok(!page.text.includes('data-form="edit-event"'));
    assert.ok(!page.text.includes('data-form="publish"'));
    assert.ok(!/Publicar<\/button>/.test(page.text));
    assert.ok(!hasCancelButton(page.text));

    const edit = await a.postForm(`/organizer/events/${event.id}`, editForm({ ...event, name: 'Outro nome' }));
    assert.equal(edit.status, 409);
    const publish = await a.postForm(`/organizer/events/${event.id}/publish`);
    assert.equal(publish.status, 409);
    const again = await a.postForm(`/organizer/events/${event.id}/cancel`);
    assert.equal(again.status, 409);
    assert.match(again.text, /Evento já está cancelado/);

    assert.deepEqual(await eventRow(event.id), snapshot, 'evento continua cancelado com os mesmos dados');
  });

  test('CAN-ACL-01: outro organizador → 404 sem dados; participante → 403; visitante → /login; continua publicado e na vitrine', async () => {
    const event = await createEventRow({ name: 'Show Secreto do A' });
    const b = await as(SEED.orgB);
    const rb = await b.postForm(`/organizer/events/${event.id}/cancel`);
    assert.equal(rb.status, 404);
    assert.ok(!rb.text.includes('Show Secreto do A'));

    const p = await signup();
    const rp = await p.postForm(`/organizer/events/${event.id}/cancel`);
    assert.equal(rp.status, 403);

    const v = createClient(server.baseUrl);
    const rv = await v.postForm(`/organizer/events/${event.id}/cancel`);
    assert.equal(rv.status, 302);
    assert.match(rv.location, /\/login/);

    assert.equal((await eventRow(event.id)).status, 'published');
    assert.ok(showcaseHas((await v.get('/')).text, event.id));
  });
});
