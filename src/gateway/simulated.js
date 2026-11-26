import { config } from '../config.js';

// Gateway de pagamento simulado (F03.P4). Nenhuma chave é lida: o único gateway é este.
//
//   decide(cardNumber, random = Math.random, scale = config.gatewayDelayScale) → { outcome, delayMs }
//
// Decisão pelo final do cartão; atraso sorteado na faixa × GATEWAY_DELAY_SCALE (padrão 1).
// O teto de 4800 ms para 0001 deixa folga para o intervalo do worker ("confirmado em até 5 s").
export const GATEWAY_TABLE = Object.freeze({
  '0001': { outcome: 'approved', minMs: 2000, maxMs: 4800 },
  '0002': { outcome: 'declined', minMs: 2000, maxMs: 5000 },
  '0003': { outcome: 'approved', minMs: 30000, maxMs: 40000 },
  '0004': { outcome: 'declined', minMs: 30000, maxMs: 40000 },
});
export const GATEWAY_DEFAULT = Object.freeze({ outcome: 'declined', minMs: 2000, maxMs: 5000 });

export function gatewayRule(cardNumber) {
  return GATEWAY_TABLE[String(cardNumber).slice(-4)] || GATEWAY_DEFAULT;
}

export function decide(cardNumber, random = Math.random, scale = config.gatewayDelayScale) {
  const { outcome, minMs, maxMs } = gatewayRule(cardNumber);
  const r = Math.min(Math.max(Number(random()) || 0, 0), 1);
  const drawn = minMs + r * (maxMs - minMs);
  const factor = Number.isFinite(scale) && scale >= 0 ? scale : 1;
  return { outcome, delayMs: Math.round(drawn * factor) };
}
