// Registro de jobs de background (ex.: worker do gateway em F03).
//
//   registerBackgroundJob('gateway-worker', () => { const t = setInterval(...); return () => clearInterval(t); });
//
// startFn é chamado por startBackgroundJobs() (src/main.js, depois do listen) e pode retornar
// uma função de parada (sync ou async), chamada por stopBackgroundJobs() no desligamento.
// Os testes não iniciam jobs por padrão (startTestServer({ backgroundJobs: true }) inicia).

const jobs = new Map();
const running = new Map();

export function registerBackgroundJob(name, startFn) {
  if (typeof startFn !== 'function') throw new TypeError(`job ${name}: startFn precisa ser função`);
  if (jobs.has(name)) throw new Error(`job ${name} já registrado`);
  jobs.set(name, startFn);
}

export function listBackgroundJobs() {
  return [...jobs.keys()];
}

export async function startBackgroundJobs({ log = console.log } = {}) {
  for (const [name, startFn] of jobs) {
    if (running.has(name)) continue;
    const stop = await startFn();
    running.set(name, typeof stop === 'function' ? stop : null);
    log(`[background] ${name} iniciado`);
  }
}

export async function stopBackgroundJobs() {
  for (const [name, stop] of [...running].reverse()) {
    running.delete(name);
    if (stop) await stop();
  }
}
