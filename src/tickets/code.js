import { randomInt } from 'node:crypto';

// Sem caracteres ambíguos (0, O, 1, I, L).
export const TICKET_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const TICKET_CODE_LENGTH = 8;

// Código único do ingresso (R09): 8 caracteres de TICKET_CODE_ALPHABET.
export function generateTicketCode() {
  let out = '';
  for (let i = 0; i < TICKET_CODE_LENGTH; i++) out += TICKET_CODE_ALPHABET[randomInt(TICKET_CODE_ALPHABET.length)];
  return out;
}
