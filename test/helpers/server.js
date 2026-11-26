// Sobe o app (createApp) numa porta efêmera dentro do processo de teste.
import { createApp } from '../../src/app.js';
import { startBackgroundJobs, stopBackgroundJobs } from '../../src/background.js';

// startTestServer({ backgroundJobs: false, app }) → { baseUrl, app, close }
// backgroundJobs: true inicia os jobs registrados (ex.: worker do gateway em F03).
// app: permite passar um express app próprio (ex.: teste de middleware).
export async function startTestServer({ backgroundJobs = false, app = createApp() } = {}) {
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });
  if (backgroundJobs) await startBackgroundJobs({ log: () => {} });
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    app,
    async close() {
      if (backgroundJobs) await stopBackgroundJobs();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
