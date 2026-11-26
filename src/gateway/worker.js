import { withTransaction } from '../db/pool.js';
import { registerBackgroundJob } from '../background.js';
import { onPurchaseCommitted } from '../tickets/purchase.js';

// Worker do gateway simulado (F03.P4).
//
// A resposta do gateway fica persistida em payment_attempts (outcome + respond_at). O worker roda a cada 200 ms e
// também num setTimeout agendado para o respond_at de cada compra recém-criada; reiniciar o app não perde respostas.
// Guarda de R08/R11: o ingresso só muda se ainda estiver 'pending' (resposta tardia não mexe em cancelado/estornado).
// processed_at é marcado sempre, mesmo quando o ingresso não muda.

export const WORKER_INTERVAL_MS = 200;
const BATCH = 50;

// Processa as tentativas vencidas (respond_at <= agora). Retorna quantas foram processadas.
// FOR UPDATE SKIP LOCKED: vários workers/chamadas concorrentes nunca processam a mesma tentativa.
export async function processDueAttempts({ limit = BATCH } = {}) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `select id, ticket_id, outcome
         from payment_attempts
        where processed_at is null and respond_at <= clock_timestamp()
        order by respond_at
        for update skip locked
        limit $1`,
      [limit],
    );
    for (const attempt of rows) {
      await client.query(
        `update tickets
            set status = $2, updated_at = now()
          where id = $1 and status = 'pending'`,
        [attempt.ticket_id, attempt.outcome === 'approved' ? 'confirmed' : 'declined'],
      );
      await client.query('update payment_attempts set processed_at = now() where id = $1', [attempt.id]);
    }
    return rows.length;
  });
}

let state = null;

// Executa processDueAttempts sem sobreposição; pedidos durante uma execução disparam mais uma rodada.
function runOnce() {
  const s = state;
  if (!s || s.stopping) return;
  if (s.running) {
    s.again = true;
    return;
  }
  s.running = (async () => {
    try {
      do {
        s.again = false;
        let n;
        do {
          n = await processDueAttempts();
        } while (n === BATCH && !s.stopping);
      } while (s.again && !s.stopping);
    } catch (err) {
      console.error('[gateway-worker] falha ao processar respostas:', err.message);
    } finally {
      s.running = null;
    }
  })();
}

function scheduleAt(respondAt) {
  if (!state || state.stopping) return;
  const delay = Math.max(0, new Date(respondAt).getTime() - Date.now()) + 5;
  const timer = setTimeout(() => {
    state?.timers.delete(timer);
    runOnce();
  }, delay);
  timer.unref?.();
  state.timers.add(timer);
}

export function startGatewayWorker({ intervalMs = WORKER_INTERVAL_MS } = {}) {
  if (state) return stopGatewayWorker;
  state = { running: null, again: false, stopping: false, timers: new Set(), interval: null, unsubscribe: null };
  state.interval = setInterval(runOnce, intervalMs);
  state.interval.unref?.();
  state.unsubscribe = onPurchaseCommitted(({ attempt }) => scheduleAt(attempt.respond_at));
  runOnce(); // respostas que venceram enquanto o app estava parado
  return stopGatewayWorker;
}

export async function stopGatewayWorker() {
  if (!state) return;
  const s = state;
  s.stopping = true;
  clearInterval(s.interval);
  for (const t of s.timers) clearTimeout(t);
  s.unsubscribe?.();
  if (s.running) await s.running;
  state = null;
}

export function isGatewayWorkerRunning() {
  return Boolean(state);
}

registerBackgroundJob('gateway-worker', startGatewayWorker);
