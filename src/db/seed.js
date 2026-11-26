import { pool, closePool, waitForDatabase, isMain } from './pool.js';
import { hashPassword } from '../auth/password.js';
import { newId } from '../ids.js';

export const SEED_PASSWORD = 'catraca123';

export const SEED_USERS = Object.freeze([
  { name: 'Organizador A', email: 'org.a@catraca.dev', role: 'organizer' },
  { name: 'Organizador B', email: 'org.b@catraca.dev', role: 'organizer' },
  { name: 'Participante Seed', email: 'participante@catraca.dev', role: 'participant' },
]);

// Idempotente: INSERT ... ON CONFLICT (email) DO NOTHING. Não cria eventos.
export async function seed({ log = console.log } = {}) {
  let created = 0;
  for (const u of SEED_USERS) {
    const passwordHash = await hashPassword(SEED_PASSWORD);
    const { rowCount } = await pool.query(
      `insert into users (id, name, email, password_hash, role)
       values ($1, $2, $3, $4, $5)
       on conflict (email) do nothing`,
      [newId('usr'), u.name, u.email, passwordHash, u.role],
    );
    created += rowCount;
  }
  log(`[seed] ${created} usuário(s) criado(s), ${SEED_USERS.length - created} já existia(m)`);
  return created;
}

if (isMain(import.meta.url)) {
  try {
    await waitForDatabase();
    await seed();
    await closePool();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
