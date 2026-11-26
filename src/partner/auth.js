import crypto from 'node:crypto';
import { config } from '../config.js';

// Autenticação da API de parceiros (F04-AC01): header X-Api-Key comparado com config.partnerApiKey
// (PARTNER_API_KEY, padrão "catraca-parceiro-dev") em tempo constante. Ausente ou diferente → 401.

const expected = crypto.createHash('sha256').update(String(config.partnerApiKey)).digest();

export function isValidApiKey(value) {
  if (typeof value !== 'string' || value === '') return false;
  // Compara digests de tamanho fixo: timingSafeEqual exige buffers do mesmo tamanho e não vaza o tamanho da chave.
  const got = crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(got, expected);
}

export function requireApiKey(req, res, next) {
  if (!isValidApiKey(req.get('x-api-key'))) return res.status(401).json({ error: 'unauthorized' });
  next();
}
