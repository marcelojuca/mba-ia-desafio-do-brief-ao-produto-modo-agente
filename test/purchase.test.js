import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb, query } from './helpers/db.js';
import { createEventRow, ticketsOf, countTickets, card, userIdByEmail } from './helpers/fixtures.js';
import { SEED } from './helpers/client.js';
import { purchaseTicket } from '../src/tickets/purchase.js';
import { getAvailability, occupiedSeats } from '../src/tickets/availability.js';
import { TICKET_CODE_ALPHABET } from '../src/tickets/code.js';
import { getTicketById } from '../src/tickets/repo.js';
import { ticketStatusLabel, TICKET_STATUS_LABELS } from '../src/tickets/status.js';

before(resetDb);
after(closeDb);

const buy = (eventId, overrides = {}) =>
  purchaseTicket({ eventId, buyerEmail: 'comprador@exemplo.com', cardNumber: card('0001'), channel: 'web', ...overrides });

describe('purchaseTicket', () => {
  beforeEach(resetDb);

  test('sucesso: ingresso pending, código de 8 caracteres, preço do evento, tentativa de pagamento', async () => {
    const event = await createEventRow({ priceCents: 12345 });
    const userId = await userIdByEmail(SEED.participant);
    const t0 = Date.now();
    const r = await buy(event.id, { userId, cardNumber: card('0003') });
    assert.ok(Date.now() - t0 < 1000, 'não espera o gateway');
    assert.equal(r.ok, true);
    assert.match(r.ticket.id, /^tkt_[0-9a-z]{12}$/);
    assert.equal(r.ticket.status, 'pending');
    assert.equal(r.ticket.price_cents, 12345);
    assert.equal(r.ticket.channel, 'web');
    assert.equal(r.ticket.user_id, userId);
    assert.equal(r.ticket.buyer_email, 'comprador@exemplo.com');
    assert.equal(r.ticket.code.length, 8);
    for (const ch of r.ticket.code) assert.ok(TICKET_CODE_ALPHABET.includes(ch), r.ticket.code);
    assert.doesNotMatch(r.ticket.code, /[01OIL]/);
    const { rows } = await query('select * from payment_attempts where ticket_id = $1', [r.ticket.id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].card_last4, '0003');
    assert.equal(rows[0].outcome, 'approved');
    assert.equal(rows[0].processed_at, null);
    assert.ok(new Date(rows[0].respond_at) > new Date(rows[0].created_at));
    // F04 consome getTicketById
    const t = await getTicketById(r.ticket.id);
    assert.equal(t.code, r.ticket.code);
    assert.equal(await getTicketById('tkt_inexistente0'), null);
  });

  test('canal partner sem usuário', async () => {
    const event = await createEventRow();
    const r = await buy(event.id, { channel: 'partner' });
    assert.equal(r.ok, true);
    assert.equal(r.ticket.channel, 'partner');
    assert.equal(r.ticket.user_id, null);
  });

  test('invalid_request: e-mail mal formado, cartão sem exatamente 16 dígitos, tipos errados', async () => {
    const event = await createEventRow();
    const bad = [
      { buyerEmail: 'sem-arroba' },
      { buyerEmail: 'a@b' },
      { buyerEmail: '' },
      { buyerEmail: undefined },
      { buyerEmail: 123 },
      { cardNumber: '123' },
      { cardNumber: '40000000000000012' },
      { cardNumber: '400000000000000' },
      { cardNumber: '4000 0000 0000 0001' },
      { cardNumber: '400000000000000a' },
      { cardNumber: 4000000000000001 },
      { cardNumber: undefined },
    ];
    for (const o of bad) {
      assert.deepEqual(await buy(event.id, o), { ok: false, error: 'invalid_request' }, JSON.stringify(o));
    }
    assert.equal(await countTickets(), 0);
  });

  test('ordem dos erros: invalid_request → event_not_available → sold_out', async () => {
    // inválido em evento inexistente → invalid_request
    assert.equal((await buy('evt_naoexiste00', { cardNumber: '1' })).error, 'invalid_request');
    // inexistente / rascunho / cancelado → event_not_available
    assert.equal((await buy('evt_naoexiste00')).error, 'event_not_available');
    const draft = await createEventRow({ status: 'draft', capacity: 1 });
    const cancelled = await createEventRow({ status: 'cancelled', capacity: 1 });
    assert.equal((await buy(draft.id)).error, 'event_not_available');
    assert.equal((await buy(cancelled.id)).error, 'event_not_available');
    // rascunho cheio → event_not_available (evento antes de vagas)
    await query(
      `insert into tickets (id, event_id, buyer_email, code, price_cents, channel)
       values ('tkt_draftfull00', $1, 'x@y.com', 'ZZZZZZZZ', 100, 'web')`,
      [draft.id],
    );
    assert.equal((await buy(draft.id)).error, 'event_not_available');
    // publicado cheio → sold_out; inválido em evento cheio → invalid_request
    const full = await createEventRow({ capacity: 1 });
    assert.equal((await buy(full.id)).ok, true);
    assert.equal((await buy(full.id)).error, 'sold_out');
    assert.equal((await buy(full.id, { buyerEmail: 'x' })).error, 'invalid_request');
    assert.equal(await countTickets(full.id), 1);
  });

  test('pendente e confirmado ocupam vaga; recusado, cancelado e estornado não', async () => {
    const event = await createEventRow({ capacity: 2 });
    const a = await buy(event.id);
    assert.equal((await getAvailability(event.id)).available, 1);
    await query("update tickets set status = 'confirmed' where id = $1", [a.ticket.id]);
    const b = await buy(event.id);
    assert.deepEqual(await getAvailability(event.id), { capacity: 2, occupied: 2, available: 0 });
    assert.equal((await buy(event.id)).error, 'sold_out');
    for (const status of ['declined', 'cancelled', 'refunded']) {
      await query('update tickets set status = $2 where id = $1', [b.ticket.id, status]);
      assert.equal((await getAvailability(event.id)).available, 1, status);
    }
    const c = await buy(event.id);
    assert.equal(c.ok, true);
    assert.equal(await occupiedSeats(null, event.id), 2);
  });

  test('preço vigente por compra (snapshot)', async () => {
    const event = await createEventRow({ priceCents: 10000 });
    const first = await buy(event.id);
    await query('update events set price_cents = 15000 where id = $1', [event.id]);
    const second = await buy(event.id);
    const byId = Object.fromEntries((await ticketsOf(event.id)).map((t) => [t.id, t.price_cents]));
    assert.equal(byId[first.ticket.id], 10000);
    assert.equal(byId[second.ticket.id], 15000);
  });
});

describe('getAvailability', () => {
  beforeEach(resetDb);

  test('availability cancelled: evento cancelado tem 0 vagas, mesmo sem ingressos', async () => {
    const event = await createEventRow({ capacity: 5, status: 'cancelled' });
    assert.deepEqual(await getAvailability(event.id), { capacity: 5, occupied: 0, available: 0 });
  });

  test('nunca negativo (ocupadas acima da lotação após ajuste direto no banco)', async () => {
    const event = await createEventRow({ capacity: 2 });
    await buy(event.id);
    await buy(event.id);
    await query('update events set capacity = 1 where id = $1', [event.id]);
    assert.deepEqual(await getAvailability(event.id), { capacity: 1, occupied: 2, available: 0 });
  });

  test('evento inexistente → null; rascunho mostra lotação cheia disponível', async () => {
    assert.equal(await getAvailability('evt_naoexiste00'), null);
    const draft = await createEventRow({ status: 'draft', capacity: 3 });
    assert.equal((await getAvailability(draft.id)).available, 3);
  });
});

describe('status', () => {
  test('rótulos pt-BR', () => {
    assert.deepEqual(TICKET_STATUS_LABELS, {
      pending: 'pendente',
      confirmed: 'confirmado',
      declined: 'recusado',
      cancelled: 'cancelado',
      refunded: 'estornado',
    });
    assert.equal(ticketStatusLabel('confirmed'), 'confirmado');
  });
});

describe('R07 — concorrência', () => {
  before(resetDb);

  test('30 compras simultâneas em lotação 5 → exatamente 5 ok e 25 sold_out (5 rodadas, eventos novos)', async () => {
    for (let round = 1; round <= 5; round++) {
      const event = await createEventRow({ capacity: 5, name: `Concorrência ${round}` });
      const results = await Promise.all(
        Array.from({ length: 30 }, (_, i) => buy(event.id, { buyerEmail: `c${round}-${i}@exemplo.com` })),
      );
      const ok = results.filter((r) => r.ok).length;
      const soldOut = results.filter((r) => !r.ok && r.error === 'sold_out').length;
      assert.equal(ok, 5, `rodada ${round}: sucessos`);
      assert.equal(soldOut, 25, `rodada ${round}: sold_out`);
      const { rows } = await query(
        "select count(*)::int as n from tickets where event_id = $1 and status in ('pending','confirmed')",
        [event.id],
      );
      assert.equal(rows[0].n, 5, `rodada ${round}: ocupadas no banco`);
      assert.equal((await getAvailability(event.id)).available, 0);
    }
  });
});
