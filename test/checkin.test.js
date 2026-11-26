import { describe, test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb, query } from './helpers/db.js';
import { createEventRow, userIdByEmail } from './helpers/fixtures.js';
import { SEED } from './helpers/client.js';
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
