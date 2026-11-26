import { parseDateTimeLocal } from '../web/html.js';

// Validação dos campos do evento (R01). Usada na criação e em toda edição.
//
//   parseEventInput(body, now) → { value: { name, startsAt, venue, capacity, priceCents } }
//                               | { errors: { campo: mensagem } }

export const MESSAGES = Object.freeze({
  nameRequired: 'Informe o nome do evento',
  nameTooLong: 'Nome muito longo (máximo 200 caracteres)',
  venueRequired: 'Informe o local do evento',
  venueTooLong: 'Local muito longo (máximo 200 caracteres)',
  startsAtInvalid: 'Informe a data e a hora de início',
  startsAtPast: 'A data de início precisa estar no futuro',
  capacity: 'Lotação deve ser um inteiro maior ou igual a 1',
  capacityTooBig: 'Lotação muito alta (máximo 1.000.000)',
  priceInvalid: 'Preço inválido (use, por exemplo, 100,00)',
  pricePositive: 'Preço deve ser maior que zero',
  priceTooBig: 'Preço muito alto (máximo R$ 1.000.000,00)',
});

const MAX_TEXT = 200;
const MAX_CAPACITY = 1_000_000;
const MAX_PRICE_CENTS = 100_000_000; // R$ 1.000.000,00

function str(value) {
  return typeof value === 'string' ? value : '';
}

// Preço em reais → centavos inteiros. Aceita "100", "100,00", "100.00", "1.234,56" (e "R$ 100").
// Vírgula é sempre separador decimal (pt-BR); ponto seguido de 3 dígitos é separador de milhar.
// Retorna número de centavos (pode ser 0 ou negativo) ou null se o formato for inválido.
export function parsePriceToCents(input) {
  let s = str(input).trim().replace(/^R\$\s*/i, '').replace(/\s+/g, '');
  let sign = 1;
  if (s.startsWith('-')) {
    sign = -1;
    s = s.slice(1);
  }
  let intPart;
  let decPart = '';
  let m;
  if ((m = /^(\d+)$/.exec(s))) {
    intPart = m[1];
  } else if ((m = /^(\d+)[.,](\d{1,2})$/.exec(s))) {
    [, intPart, decPart] = m;
  } else if ((m = /^(\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/.exec(s))) {
    intPart = m[1].replace(/\./g, '');
    decPart = m[2] || '';
  } else {
    return null;
  }
  if (intPart.length > 12) return null;
  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, '0'));
  return sign * cents;
}

// Lotação: inteiro (só dígitos) ≥ 1. Retorna número ou null.
export function parseCapacity(input) {
  const s = str(input).trim();
  if (!/^\d{1,9}$/.test(s)) return null;
  return Number(s);
}

export function parseEventInput(body = {}, now = new Date()) {
  const errors = {};

  const name = str(body.name).trim();
  if (!name) errors.name = MESSAGES.nameRequired;
  else if (name.length > MAX_TEXT) errors.name = MESSAGES.nameTooLong;

  const venue = str(body.venue).trim();
  if (!venue) errors.venue = MESSAGES.venueRequired;
  else if (venue.length > MAX_TEXT) errors.venue = MESSAGES.venueTooLong;

  const startsAt = parseDateTimeLocal(body.startsAt);
  if (!startsAt) errors.startsAt = MESSAGES.startsAtInvalid;
  else if (startsAt.getTime() <= new Date(now).getTime()) errors.startsAt = MESSAGES.startsAtPast;

  const capacity = parseCapacity(body.capacity);
  if (capacity === null || capacity < 1) errors.capacity = MESSAGES.capacity;
  else if (capacity > MAX_CAPACITY) errors.capacity = MESSAGES.capacityTooBig;

  const priceCents = parsePriceToCents(body.price);
  if (priceCents === null) errors.price = str(body.price).trim() ? MESSAGES.priceInvalid : MESSAGES.pricePositive;
  else if (priceCents <= 0) errors.price = MESSAGES.pricePositive;
  else if (priceCents > MAX_PRICE_CENTS) errors.price = MESSAGES.priceTooBig;

  if (Object.keys(errors).length) return { errors };
  return { value: { name, startsAt, venue, capacity, priceCents } };
}
