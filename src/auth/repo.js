import { query } from '../db/pool.js';

const PUBLIC_COLUMNS = 'id, name, email, role, created_at';

export async function findUserByEmail(email) {
  const { rows } = await query(`select ${PUBLIC_COLUMNS}, password_hash from users where email = $1`, [email]);
  return rows[0] || null;
}

export async function findUserById(id) {
  const { rows } = await query(`select ${PUBLIC_COLUMNS} from users where id = $1`, [id]);
  return rows[0] || null;
}

// Lança erro com code '23505' se o e-mail já existir.
export async function insertUser({ id, name, email, passwordHash, role }) {
  const { rows } = await query(
    `insert into users (id, name, email, password_hash, role)
     values ($1, $2, $3, $4, $5)
     returning ${PUBLIC_COLUMNS}`,
    [id, name, email, passwordHash, role],
  );
  return rows[0];
}

export async function insertSession(token, userId, expiresAt) {
  await query('insert into sessions (token, user_id, expires_at) values ($1, $2, $3)', [token, userId, expiresAt]);
}

export async function findSessionUser(token) {
  const { rows } = await query(
    `select u.id, u.name, u.email, u.role
       from sessions s join users u on u.id = s.user_id
      where s.token = $1 and s.expires_at > now()`,
    [token],
  );
  return rows[0] || null;
}

export async function deleteSession(token) {
  await query('delete from sessions where token = $1', [token]);
}

export async function deleteExpiredSessions() {
  await query('delete from sessions where expires_at <= now()');
}
