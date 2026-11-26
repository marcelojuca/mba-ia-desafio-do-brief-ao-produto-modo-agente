import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb, query } from './helpers/db.js';
import { migrate } from '../src/db/migrate.js';
import { seed, SEED_USERS, SEED_PASSWORD } from '../src/db/seed.js';
import { verifyPassword } from '../src/auth/password.js';

const silent = () => {};

before(resetDb);
after(closeDb);

test('migração é idempotente: segunda execução não aplica nada', async () => {
  const again = await migrate({ log: silent });
  assert.deepEqual(again, []);
  const { rows } = await query("select name from schema_migrations where name = '0001_users_sessions.sql'");
  assert.equal(rows.length, 1);
});

test('migrações aplicadas criam users e sessions', async () => {
  const { rows } = await query(
    "select tablename from pg_tables where schemaname = 'public' and tablename in ('users','sessions') order by 1",
  );
  assert.deepEqual(
    rows.map((r) => r.tablename),
    ['sessions', 'users'],
  );
});

test('seed é idempotente: rodar de novo não duplica nem falha', async () => {
  const created1 = await seed({ log: silent });
  const created2 = await seed({ log: silent });
  assert.equal(created1, 0);
  assert.equal(created2, 0);
  const { rows } = await query("select count(*)::int as n from users where email like '%@catraca.dev'");
  assert.equal(rows[0].n, 3);
});

test('seed cria organizador A, organizador B e participante com a senha documentada', async () => {
  for (const u of SEED_USERS) {
    const { rows } = await query('select name, role, password_hash from users where email = $1', [u.email]);
    assert.equal(rows.length, 1, u.email);
    assert.equal(rows[0].role, u.role);
    assert.equal(rows[0].name, u.name);
    assert.ok(await verifyPassword(SEED_PASSWORD, rows[0].password_hash));
    assert.match(rows[0].password_hash, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
  }
  const roles = Object.fromEntries(SEED_USERS.map((u) => [u.email, u.role]));
  assert.deepEqual(roles, {
    'org.a@catraca.dev': 'organizer',
    'org.b@catraca.dev': 'organizer',
    'participante@catraca.dev': 'participant',
  });
});

test('resetDb apaga dados e mantém schema_migrations', async () => {
  await query(
    "insert into users (id, name, email, password_hash, role) values ('usr_tmp', 'Tmp', 'tmp@example.com', 'x', 'participant')",
  );
  await resetDb();
  const { rows } = await query('select count(*)::int as n from users');
  assert.equal(rows[0].n, 3);
  const mig = await query('select count(*)::int as n from schema_migrations');
  assert.ok(mig.rows[0].n >= 1);
});
