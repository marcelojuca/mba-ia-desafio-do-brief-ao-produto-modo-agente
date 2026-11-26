import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { config } from '../config.js';

// int8 (count/sum) como Number: os valores do domínio cabem com folga.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 20,
});

pool.on('error', (err) => {
  console.error('[db] erro em conexão ociosa do pool:', err.message);
});

export function query(text, params) {
  return pool.query(text, params);
}

// Executa fn(client) dentro de BEGIN/COMMIT; ROLLBACK em qualquer erro.
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // conexão quebrada: o erro original é o que importa
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function waitForDatabase({ attempts = 30, delayMs = 1000 } = {}) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query('select 1');
      return;
    } catch (err) {
      if (i === attempts) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

export function closePool() {
  return pool.end();
}

// true quando o módulo foi executado diretamente (node src/db/x.js)
export function isMain(importMetaUrl) {
  return Boolean(process.argv[1]) && fileURLToPath(importMetaUrl) === resolve(process.argv[1]);
}
