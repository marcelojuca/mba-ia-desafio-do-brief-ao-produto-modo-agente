import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { insertSession, findSessionUser, deleteSession } from './repo.js';

export const SESSION_COOKIE = 'catraca_session';
const TTL_MS = config.sessionTtlDays * 24 * 60 * 60 * 1000;

const cookieOptions = { httpOnly: true, sameSite: 'lax', path: '/' };

export async function createSession(res, userId) {
  const token = randomBytes(32).toString('hex');
  await insertSession(token, userId, new Date(Date.now() + TTL_MS));
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: TTL_MS });
  return token;
}

export async function destroySession(req, res) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) await deleteSession(token);
  res.clearCookie(SESSION_COOKIE, cookieOptions);
  req.user = null;
  res.locals.user = null;
}

// Middleware: popula req.user ({ id, name, email, role }) ou null.
export async function loadSession(req, res, next) {
  req.user = null;
  res.locals.user = null;
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return next();
  try {
    const user = await findSessionUser(token);
    if (user) {
      req.user = user;
      res.locals.user = user;
    }
    next();
  } catch (err) {
    next(err);
  }
}
