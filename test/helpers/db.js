// Helpers de banco para testes (banco de teste próprio: DATABASE_URL do projeto catraca-gates).
import { pool, query, closePool } from '../../src/db/pool.js';
import { migrate } from '../../src/db/migrate.js';
import { seed } from '../../src/db/seed.js';

export { pool, query };

const silent = () => {};
let migrated = false;

export async function ensureMigrated() {
  if (!migrated) {
    await migrate({ log: silent });
    migrated = true;
  }
}

// Migra (uma vez por processo), apaga os dados de todas as tabelas da aplicação
// (exceto schema_migrations) com RESTART IDENTITY CASCADE e roda a seed.
export async function resetDb() {
  await ensureMigrated();
  const { rows } = await query(
    `select tablename from pg_tables
      where schemaname = 'public' and tablename <> 'schema_migrations'`,
  );
  if (rows.length) {
    const tables = rows.map((r) => `"${r.tablename}"`).join(', ');
    await query(`truncate table ${tables} restart identity cascade`);
  }
  await seed({ log: silent });
}

export async function closeDb() {
  await closePool();
}
