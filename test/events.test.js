import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEventInput, parsePriceToCents, parseCapacity, MESSAGES } from '../src/events/validation.js';

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
