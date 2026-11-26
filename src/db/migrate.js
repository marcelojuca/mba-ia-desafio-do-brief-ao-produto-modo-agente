import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool, closePool, waitForDatabase, isMain } from './pool.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const LOCK_KEY = 4815162342; // advisory lock: evita duas execuções simultâneas

// Aplica, em ordem, os arquivos NNNN_nome.sql ainda não registrados em schema_migrations.
export async function migrate({ log = console.log } = {}) {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )`);
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
    const { rows } = await client.query('select name from schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    const done = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations(name) values ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migração ${file} falhou: ${err.message}`);
      }
      done.push(file);
      log(`[migrate] aplicada ${file}`);
    }
    if (!done.length) log('[migrate] nada a aplicar');
    return done;
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  }
}

if (isMain(import.meta.url)) {
  try {
    await waitForDatabase();
    await migrate();
    await closePool();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
