import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb, query } from './helpers/db.js';
import { startTestServer } from './helpers/server.js';
import { createClient, SEED } from './helpers/client.js';
import { createEventRow, card } from './helpers/fixtures.js';
import { purchaseTicket } from '../src/tickets/purchase.js';
import { toDateTimeLocal } from '../src/web/html.js';
import { centsToPriceInput } from '../src/events/page.js';

let server;
before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
  await closeDb();
});

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

const buy = (eventId) =>
  purchaseTicket({ eventId, buyerEmail: 'x@exemplo.com', cardNumber: card('0003'), channel: 'web' });

describe('validador de lotação (R03) na página de gestão de F02', () => {
  beforeEach(resetDb);

  test('reduzir abaixo das ocupadas → 422 com mensagem; igual ou acima → aceito', async () => {
    const event = await createEventRow({ capacity: 2 });
    await buy(event.id);
    await buy(event.id);
    const a = createClient(server.baseUrl);
    await a.login(SEED.orgA);

    const r1 = await a.postForm(`/organizer/events/${event.id}`, editForm(event, { capacity: '1' }));
    assert.equal(r1.status, 422);
    assert.ok(r1.text.includes('A lotação não pode ser menor que as vagas ocupadas (2)'), r1.text);
    assert.equal((await query('select capacity from events where id = $1', [event.id])).rows[0].capacity, 2);

    const r2 = await a.postForm(`/organizer/events/${event.id}`, editForm(event, { capacity: '2' }));
    assert.equal(r2.status, 303);

    const r3 = await a.postForm(`/organizer/events/${event.id}`, editForm(event, { capacity: '3' }));
    assert.equal(r3.status, 303);
    assert.equal((await query('select capacity from events where id = $1', [event.id])).rows[0].capacity, 3);
  });

  test('recusados/cancelados não contam como ocupados', async () => {
    const event = await createEventRow({ capacity: 3 });
    const t1 = await buy(event.id);
    await buy(event.id);
    await query("update tickets set status = 'declined' where id = $1", [t1.ticket.id]);
    const a = createClient(server.baseUrl);
    await a.login(SEED.orgA);
    const r = await a.postForm(`/organizer/events/${event.id}`, editForm(event, { capacity: '1' }));
    assert.equal(r.status, 303);
    const r2 = await a.postForm(`/organizer/events/${event.id}`, editForm({ ...event, capacity: 1 }, { capacity: '0' }));
    assert.equal(r2.status, 422);
  });
});
