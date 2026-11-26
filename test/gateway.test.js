import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, gatewayRule } from '../src/gateway/simulated.js';

const card = (last4) => `400000000000${last4}`;

describe('gateway simulado — tabela de finais', () => {
  const cases = [
    ['0001', 'approved', 2000, 4800],
    ['0002', 'declined', 2000, 5000],
    ['0003', 'approved', 30000, 40000],
    ['0004', 'declined', 30000, 40000],
    ['9999', 'declined', 2000, 5000],
    ['0005', 'declined', 2000, 5000],
    ['1234', 'declined', 2000, 5000],
  ];

  for (const [last4, outcome, min, max] of cases) {
    test(`final ${last4} → ${outcome} em ${min}–${max} ms (escala 1)`, () => {
      assert.deepEqual(decide(card(last4), () => 0, 1), { outcome, delayMs: min });
      assert.deepEqual(decide(card(last4), () => 1, 1), { outcome, delayMs: max });
      for (let i = 0; i < 200; i++) {
        const d = decide(card(last4), Math.random, 1);
        assert.equal(d.outcome, outcome);
        assert.ok(d.delayMs >= min && d.delayMs <= max, `${last4}: ${d.delayMs}`);
      }
    });
  }

  test('0001 confirma com folga para "até 5 s" (teto 4800 ms)', () => {
    assert.ok(gatewayRule(card('0001')).maxMs <= 4800);
  });

  test('escala multiplica o atraso (GATEWAY_DELAY_SCALE)', () => {
    assert.equal(decide(card('0003'), () => 0.5, 0.01).delayMs, 350);
    assert.equal(decide(card('0001'), () => 0, 0.01).delayMs, 20);
    assert.equal(decide(card('0004'), () => 1, 0).delayMs, 0);
    assert.equal(decide(card('0002'), () => 0.5, 2).delayMs, 7000);
  });

  test('escala padrão vem de config (gates usam 0.01)', () => {
    const d = decide(card('0003'), () => 0);
    assert.ok(d.delayMs > 0 && d.delayMs <= 30000);
  });
});
