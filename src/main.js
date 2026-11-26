// Entrypoint do container: migra → seed → listen → background jobs.
import { config } from './config.js';
import { waitForDatabase, closePool } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { seed } from './db/seed.js';
import { createApp } from './app.js';
import { startBackgroundJobs, stopBackgroundJobs } from './background.js';

async function main() {
  await waitForDatabase();
  await migrate();
  await seed();

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`[catraca] ouvindo na porta ${config.port} (${config.nodeEnv})`);
  });
  await startBackgroundJobs();

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[catraca] ${signal} recebido, encerrando`);
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    try {
      await stopBackgroundJobs();
      await new Promise((resolve) => server.close(resolve));
      server.closeAllConnections?.();
      await closePool();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[catraca] falha ao iniciar:', err);
  process.exit(1);
});
