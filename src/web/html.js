// Templates HTML com escape automático e formatação pt-BR.
//
//   html`<p>${userInput}</p>`      → valores interpolados são escapados
//   html`<ul>${items.map((i) => html`<li>${i}</li>`)}</ul>`  → arrays e html aninhado não são re-escapados
//   raw(trustedString)             → insere sem escape (use só com conteúdo gerado pelo próprio código)

export class SafeHtml {
  constructor(value) {
    this.value = String(value);
  }
  toString() {
    return this.value;
  }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

export function raw(value) {
  return new SafeHtml(value);
}

function renderValue(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(renderValue).join('');
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += renderValue(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

// ---------------------------------------------------------------------------
// Formatação. Fuso fixo America/Sao_Paulo = −03:00 (sem horário de verão).

const BRT_OFFSET_MS = -3 * 60 * 60 * 1000;
const pad = (n, len = 2) => String(n).padStart(len, '0');

// 10000 → "R$ 100,00"; 123456 → "R$ 1.234,56"; -500 → "-R$ 5,00"
export function formatBRL(cents) {
  const n = Math.round(Number(cents) || 0);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const reais = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}R$ ${reais},${pad(abs % 100)}`;
}

function brtParts(date) {
  const d = new Date(new Date(date).getTime() + BRT_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: pad(d.getUTCMonth() + 1),
    day: pad(d.getUTCDate()),
    hour: pad(d.getUTCHours()),
    minute: pad(d.getUTCMinutes()),
    second: pad(d.getUTCSeconds()),
  };
}

// → "05/12/2026 21:00"
export function formatDateTime(date) {
  const p = brtParts(date);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

// → "2026-12-05T21:00:00-03:00" (formato da API de parceiros)
export function formatIsoBrt(date) {
  const p = brtParts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}-03:00`;
}

// → "2026-12-05T21:00" (valor para <input type="datetime-local">)
export function toDateTimeLocal(date) {
  const p = brtParts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// "2026-12-05T21:00" (interpretado em −03:00) → Date; formato inválido → null
export function parseDateTimeLocal(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value ?? '').trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '00'] = m;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}-03:00`);
  if (Number.isNaN(date.getTime())) return null;
  // rejeita datas "roladas" (ex.: 31/02)
  return toDateTimeLocal(date) === `${y}-${mo}-${d}T${h}:${mi}` ? date : null;
}
