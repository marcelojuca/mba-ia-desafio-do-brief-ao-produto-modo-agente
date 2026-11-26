import { randomInt } from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

// newId('usr') → 'usr_' + 12 caracteres base36 aleatórios.
export function newId(prefix) {
  let out = '';
  for (let i = 0; i < 12; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return `${prefix}_${out}`;
}
