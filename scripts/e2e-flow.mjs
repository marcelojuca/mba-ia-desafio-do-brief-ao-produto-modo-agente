#!/usr/bin/env node
// Fluxo ponta a ponta do avaliador (F07, docs/features/F07-integracao-e2e/spec.md) — passos 2 a 16.
//
//   ./scripts/up.sh && npm run e2e
//
// Node puro (fetch nativo, sem dependências). Variáveis:
//   WEB (padrão http://localhost:3000), API (padrão = WEB), KEY (padrão catraca-parceiro-dev).
// Roda contra o gateway no modo padrão (atrasos reais): ~2 min, dominados pelas esperas de 45 s dos passos 8 e 14.
// Cada verificação imprime "✔ passo N — ..."; a primeira falha imprime "✘ passo N — esperado X, obtido Y" e sai ≠ 0.
// Repetível: cada execução cria eventos e um participante novos (sufixo único por execução).

const WEB = (process.env.WEB || 'http://localhost:3000').replace(/\/+$/, '');
const API = (process.env.API || WEB).replace(/\/+$/, '');
const KEY = process.env.KEY || 'catraca-parceiro-dev';
const PASSWORD = 'catraca123';
const SEED = { orgA: 'org.a@catraca.dev', orgB: 'org.b@catraca.dev', participant: 'participante@catraca.dev' };
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const CARD = { approved: '4000000000000001', declinedSlow: '4000000000000004', approvedSlow: '4000000000000003' };
const MSG = {
  ok: 'Entrada liberada',
  alreadyUsed: 'Ingresso já utilizado',
  notConfirmed: 'Ingresso não confirmado',
  invalid: 'Ingresso inválido para este evento',
  cancelled: 'Evento cancelado',
  soldOut: 'Ingressos esgotados',
};

const startedAt = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;
const show = (v) => (typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v) ?? String(v));

// ---------------------------------------------------------------------------
// Saída e asserções

let currentStep = 0;
class StepFailure extends Error {}

function step(n) {
  currentStep = n;
}
function pass(description) {
  console.log(`✔ passo ${currentStep} — ${description}`);
}
function fail(expected, got) {
  console.log(`✘ passo ${currentStep} — esperado ${expected}, obtido ${got}`);
  throw new StepFailure();
}
function check(cond, description, expected, got) {
  if (!cond) fail(expected, got);
  pass(description);
}
function expectEqual(got, expected, description) {
  check(Object.is(got, expected), description, show(expected), show(got));
}
function expectStatus(res, expected, description) {
  const list = Array.isArray(expected) ? expected : [expected];
  check(list.includes(res.status), description, `HTTP ${list.join(' ou ')}`, `HTTP ${res.status} ${snippet(res)}`);
}
function snippet(res) {
  if (res.json !== undefined) return JSON.stringify(res.json).slice(0, 160);
  const err = attr(res.text, 'data-error') ?? textOf(res.text, /<p class="error" data-error>([\s\S]*?)<\/p>/);
  return err ? `(${err})` : res.location ? `(Location ${res.location})` : '';
}

// Espera até cond(valor) ser verdadeiro ou o prazo acabar; retorna { ok, value, elapsed }.
async function waitFor(fn, cond, timeoutMs, intervalMs = 250) {
  const t0 = Date.now();
  let value;
  for (;;) {
    value = await fn();
    if (cond(value)) return { ok: true, value, elapsed: Date.now() - t0 };
    if (Date.now() - t0 >= timeoutMs) return { ok: false, value, elapsed: Date.now() - t0 };
    await sleep(intervalMs);
  }
}

// ---------------------------------------------------------------------------
// Cliente HTTP com cookie jar por ator (redirect: 'manual')

function createActor(name, base = WEB) {
  const jar = new Map();
  function store(res) {
    for (const header of res.headers.getSetCookie()) {
      const [pair, ...attrs] = header.split(';');
      const i = pair.indexOf('=');
      const key = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      let expired = value === '';
      for (const a of attrs) {
        const [k, v = ''] = a.trim().split('=');
        if (k.toLowerCase() === 'max-age' && Number(v) <= 0) expired = true;
        if (k.toLowerCase() === 'expires' && new Date(v).getTime() <= Date.now()) expired = true;
      }
      if (expired) jar.delete(key);
      else jar.set(key, value);
    }
  }
  async function request(method, path, { body, headers = {} } = {}) {
    const h = { ...headers };
    if (jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(new URL(path, base), { method, headers: h, body, redirect: 'manual' });
    store(res);
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, location: res.headers.get('location'), text, json };
  }
  return {
    name,
    get: (path, headers) => request('GET', path, { headers }),
    postForm: (path, data = {}) =>
      request('POST', path, {
        body: new URLSearchParams(data).toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      }),
    postJson: (path, data, headers = {}) =>
      request('POST', path, {
        body: typeof data === 'string' ? data : JSON.stringify(data),
        headers: { 'content-type': 'application/json', ...headers },
      }),
  };
}

async function login(actor, email) {
  const res = await actor.postForm('/login', { email, password: PASSWORD });
  if (res.status !== 302) fail(`login de ${email} com 302`, `HTTP ${res.status}`);
  return res;
}

// ---------------------------------------------------------------------------
// Extração de dados do HTML pelos ganchos data-* das specs

function decode(s) {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
function textOf(htmlText, re) {
  const m = re.exec(htmlText || '');
  return m ? decode(m[1]) : null;
}
// Texto do primeiro elemento com o atributo (ex.: data-error, data-notice).
function attr(htmlText, name) {
  return textOf(htmlText, new RegExp(`<\\w+[^>]*\\s${name}(?:="[^"]*")?[^>]*>([\\s\\S]*?)</`));
}
// Cartão do evento na vitrine (<article data-event-id="...">...</article>) ou null.
function showcaseCard(htmlText, eventId) {
  const m = new RegExp(`<article[^>]*data-event-id="${eventId}"[^>]*>([\\s\\S]*?)</article>`).exec(htmlText);
  return m ? m[1] : null;
}
function availableSeatsInCard(card) {
  const m = /data-available-seats="(-?\d+)"/.exec(card || '');
  return m ? Number(m[1]) : null;
}
// Linhas de "Meus ingressos": [{ code, status, eventId }]
function myTickets(htmlText) {
  const out = [];
  const re = /<tr\s+data-ticket-code="([^"]+)"\s+data-ticket-status="([^"]+)"\s+data-event-id="([^"]+)"/g;
  let m;
  while ((m = re.exec(htmlText))) out.push({ code: m[1], status: m[2], eventId: m[3] });
  return out;
}
// Painel: { confirmed, pending, checkins, available, revenue, refunded } (strings como exibidas)
function panel(htmlText) {
  const out = {};
  const re = /<dd data-metric="(\w+)">([\s\S]*?)<\/dd>/g;
  let m;
  while ((m = re.exec(htmlText))) out[m[1]] = decode(m[2]);
  return out;
}
function checkinResult(htmlText) {
  const m = /<p[^>]*data-checkin-result="(\w+)"[^>]*>([\s\S]*?)<\/p>/.exec(htmlText);
  return m ? { key: m[1], message: decode(m[2]) } : null;
}
function eventStatus(htmlText) {
  const m = /<dd data-event-status="(\w+)"/.exec(htmlText);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Datas (horário de Brasília, −03:00, como o formulário interpreta)

function brtParts(date) {
  const d = new Date(date.getTime() - 3 * 3600 * 1000);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate() };
}
const pad = (n) => String(n).padStart(2, '0');
function nextMonthAt(day, hour) {
  const { y, mo } = brtParts(new Date());
  const t = new Date(Date.UTC(y, mo + 1, day));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(hour)}:00`;
}
function yesterdayAt(hour) {
  const { y, mo, d } = brtParts(new Date());
  const t = new Date(Date.UTC(y, mo, d - 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(hour)}:00`;
}

// ---------------------------------------------------------------------------
// Operações de domínio

const apiHeaders = { 'X-Api-Key': KEY };
const api = createActor('api', API);

async function apiEvents() {
  const res = await api.get('/api/partner/events', apiHeaders);
  if (res.status !== 200 || !Array.isArray(res.json)) fail('GET /api/partner/events 200 com lista', `HTTP ${res.status}`);
  return res.json;
}
async function apiEvent(eventId) {
  return (await apiEvents()).find((e) => e.id === eventId) ?? null;
}
function apiBuy(eventId, cardNumber, buyerEmail = `parceiro-${RUN}@example.com`) {
  return api.postJson(`/api/partner/events/${eventId}/purchases`, { buyerEmail, cardNumber }, apiHeaders);
}
async function apiTicket(ticketId) {
  const res = await api.get(`/api/partner/tickets/${ticketId}`, apiHeaders);
  return res.json ?? { status: `HTTP ${res.status}` };
}
async function waitTicketStatus(ticketId, status, timeoutMs) {
  return waitFor(() => apiTicket(ticketId), (t) => t.status === status, timeoutMs);
}

function eventForm(ev) {
  return { name: ev.name, startsAt: ev.startsAt, venue: ev.venue, capacity: String(ev.capacity), price: ev.price };
}
async function createEvent(org, ev) {
  const res = await org.postForm('/organizer/events', eventForm(ev));
  const m = /^\/organizer\/events\/([^/?#]+)$/.exec(res.location || '');
  if (res.status !== 302 || !m) fail(`criação de "${ev.name}" com 302 para /organizer/events/:id`, `HTTP ${res.status} ${snippet(res)}`);
  ev.id = m[1];
  return ev;
}
async function publishEvent(org, ev) {
  const res = await org.postForm(`/organizer/events/${ev.id}/publish`);
  if (res.status !== 303) fail(`publicação de "${ev.name}" com 303`, `HTTP ${res.status} ${snippet(res)}`);
  const page = await org.get(`/organizer/events/${ev.id}`);
  if (eventStatus(page.text) !== 'published') fail(`"${ev.name}" publicado`, eventStatus(page.text));
}
async function managementPage(org, ev) {
  return org.get(`/organizer/events/${ev.id}`);
}
async function panelOf(org, ev) {
  return panel((await managementPage(org, ev)).text);
}
async function doCheckin(org, ev, code) {
  const res = await org.postForm(`/organizer/events/${ev.id}/checkin`, { code });
  return { status: res.status, result: checkinResult(res.text) };
}
function expectPanel(p, expected, description) {
  const keys = ['confirmed', 'pending', 'checkins', 'available', 'revenue', 'refunded'];
  const ok = keys.every((k) => expected[k] === undefined || p[k] === String(expected[k]));
  const fmt = (o) => keys.filter((k) => expected[k] !== undefined).map((k) => `${k}=${o[k]}`).join(' ');
  check(ok, description, fmt(expected), fmt(p));
}
async function expectCheckin(org, ev, code, key, message, description) {
  const r = await doCheckin(org, ev, code);
  check(
    r.status === 200 && r.result?.key === key && r.result?.message === message,
    description,
    `200 "${message}"`,
    `HTTP ${r.status} ${r.result ? `"${r.result.message}"` : '(sem data-checkin-result)'}`,
  );
}
function containsEventData(htmlText, ev) {
  return htmlText.includes(ev.id) || htmlText.includes(ev.name) || htmlText.includes(ev.venue);
}

// ---------------------------------------------------------------------------
// Fluxo

async function main() {
  console.log(`Catraca e2e — WEB=${WEB} API=${API} (execução ${RUN})`);
  const health = await fetch(`${WEB}/health`).catch((err) => ({ ok: false, status: err.cause?.code || err.message }));
  if (!health.ok) {
    console.log(`✘ passo 0 — esperado ambiente de pé em ${WEB}/health, obtido ${health.status} (rode ./scripts/up.sh)`);
    process.exit(1);
  }

  const orgA = createActor('A');
  const orgB = createActor('B');
  const buyer = createActor('participante novo');
  const seedParticipant = createActor('participante da seed');
  const visitor = createActor('visitante');
  await login(orgA, SEED.orgA);

  const E1 = {
    name: `E1 e2e ${RUN}`,
    startsAt: nextMonthAt(10, 21),
    venue: `Teatro E1 ${RUN}`,
    capacity: 2,
    price: '100,00',
  };

  // Passo 2 — rascunho fora da vitrine e da API
  step(2);
  await createEvent(orgA, E1);
  pass(`A cria E1 (${E1.id}, lotação 2, R$ 100,00) como rascunho`);
  {
    const page = await managementPage(orgA, E1);
    expectEqual(eventStatus(page.text), 'draft', 'E1 nasce rascunho');
    const showcase = await visitor.get('/');
    check(showcase.status === 200 && !showcaseCard(showcase.text, E1.id), 'E1 ausente da vitrine (visitante)', 'vitrine sem E1', 'E1 na vitrine');
    check(!(await apiEvent(E1.id)), 'E1 ausente de GET /api/partner/events', 'lista sem E1', 'E1 listado');
    const buy = await apiBuy(E1.id, CARD.approved);
    check(
      buy.status === 404 && buy.json?.error === 'event_not_available',
      'compra pela API em rascunho → 404 event_not_available',
      '404 event_not_available',
      `HTTP ${buy.status} ${snippet(buy)}`,
    );
  }

  // Passo 3 — data no passado
  step(3);
  {
    const res = await orgA.postForm('/organizer/events', eventForm({ ...E1, name: `Passado ${RUN}`, startsAt: yesterdayAt(20) }));
    check(
      res.status === 422 && /data-field-error="startsAt"/.test(res.text),
      'evento com data de ontem → 422 (erro no campo de início)',
      '422 com data-field-error="startsAt"',
      `HTTP ${res.status} ${snippet(res)}`,
    );
    const list = await orgA.get('/organizer');
    check(!list.text.includes(`Passado ${RUN}`), 'evento no passado não foi criado', 'lista sem o evento', 'evento criado');
  }

  // Passo 4 — publicação
  step(4);
  await publishEvent(orgA, E1);
  pass('A publica E1');
  {
    const showcase = await visitor.get('/');
    const card = showcaseCard(showcase.text, E1.id);
    check(card && availableSeatsInCard(card) === 2, 'E1 na vitrine com Vagas disponíveis: 2', 'cartão com 2 vagas', card ? availableSeatsInCard(card) : 'sem cartão');
    const ev = await apiEvent(E1.id);
    check(
      ev && ev.availableSeats === 2 && ev.priceCents === 10000 && ev.name === E1.name,
      'API lista E1 com availableSeats 2 e priceCents 10000',
      '{availableSeats:2, priceCents:10000}',
      JSON.stringify(ev),
    );
  }

  // Passo 5 — participante novo compra na vitrine com ...0001
  step(5);
  let C1;
  {
    const email = `novo-${RUN}@example.com`;
    const signup = await buyer.postForm('/signup', { name: `Participante ${RUN}`, email, password: PASSWORD });
    expectStatus(signup, 302, `participante novo cadastrado (${email})`);
    const buy = await buyer.postForm(`/events/${E1.id}/purchase`, { cardNumber: CARD.approved });
    check(
      buy.status === 303 && buy.location === '/my-tickets',
      'compra na vitrine → 303 para "Meus ingressos" (sem esperar o gateway)',
      '303 /my-tickets',
      `HTTP ${buy.status} ${snippet(buy)}`,
    );
    const first = myTickets((await buyer.get('/my-tickets')).text).filter((t) => t.eventId === E1.id);
    check(first.length === 1 && first[0].status === 'pending', 'C1 aparece como pending em "Meus ingressos"', 'um ingresso pending', JSON.stringify(first));
    C1 = first[0].code;
    check(/^[A-Z0-9]{8}$/.test(C1), `C1 = ${C1} (8 caracteres)`, 'código de 8 caracteres', C1);
    const w = await waitFor(
      async () => myTickets((await buyer.get('/my-tickets')).text).find((t) => t.code === C1)?.status,
      (s) => s === 'confirmed',
      5000,
    );
    check(w.ok, `C1 confirmed em ${secs(w.elapsed)} (≤ 5 s)`, 'confirmed em ≤ 5 s', w.value);
  }

  // Passo 6 — API compra com ...0004 (recusa lenta)
  step(6);
  const T2 = {};
  {
    const res = await apiBuy(E1.id, CARD.declinedSlow);
    T2.at = Date.now();
    check(
      res.status === 202 && res.json?.status === 'pending' && res.json?.ticketId && res.json?.code,
      `API compra E1 com ...0004 → 202 pending (T2 ${res.json?.ticketId}, C2 ${res.json?.code})`,
      '202 {status:"pending"}',
      `HTTP ${res.status} ${snippet(res)}`,
    );
    T2.id = res.json.ticketId;
    T2.code = res.json.code;
    const ev = await apiEvent(E1.id);
    expectEqual(ev?.availableSeats, 0, 'E1 com availableSeats 0 na API');
  }

  // Passo 7 — esgotado (antes de 30 s do passo 6)
  step(7);
  {
    const res = await apiBuy(E1.id, CARD.approved);
    const elapsed = Date.now() - T2.at;
    check(
      res.status === 409 && res.json?.error === 'sold_out',
      `API compra E1 com ...0001 → 409 sold_out (${secs(elapsed)} após o passo 6)`,
      '409 sold_out',
      `HTTP ${res.status} ${snippet(res)}`,
    );
    const card = showcaseCard((await buyer.get('/')).text, E1.id);
    check(
      card && /data-sold-out/.test(card) && card.includes(MSG.soldOut) && !/data-form="purchase"/.test(card),
      'vitrine do participante mostra "Ingressos esgotados" no lugar da compra de E1',
      '"Ingressos esgotados" sem formulário',
      card ? decode(card) : 'sem cartão',
    );
    const tryBuy = await buyer.postForm(`/events/${E1.id}/purchase`, { cardNumber: CARD.approved });
    check(
      tryBuy.status === 409 && attr(tryBuy.text, 'data-error') === MSG.soldOut,
      'tentativa de compra na vitrine → 409 "Ingressos esgotados"',
      `409 "${MSG.soldOut}"`,
      `HTTP ${tryBuy.status} ${snippet(tryBuy)}`,
    );
    const after = Date.now() - T2.at;
    check(after < 30_000, `verificações do passo 7 concluídas ${secs(after)} após o passo 6 (< 30 s)`, '< 30 s', secs(after));
  }

  // Passo 8 — após 45 s do passo 6: T2 recusado, vaga liberada, T3 confirmado
  step(8);
  let T3;
  {
    const wait = T2.at + 45_000 - Date.now();
    console.log(`  … aguardando ${secs(wait)} (45 s após o passo 6)`);
    await sleep(wait);
    const t2 = await apiTicket(T2.id);
    expectEqual(t2.status, 'declined', 'T2 declined após 45 s');
    const ev = await apiEvent(E1.id);
    expectEqual(ev?.availableSeats, 1, 'E1 com availableSeats 1 (vaga de T2 liberada)');
    const res = await apiBuy(E1.id, CARD.approved);
    check(res.status === 202 && res.json?.status === 'pending', `API compra T3 (...0001) → 202 pending (${res.json?.ticketId})`, '202 pending', `HTTP ${res.status} ${snippet(res)}`);
    T3 = res.json;
    const w = await waitTicketStatus(T3.ticketId, 'confirmed', 5000);
    check(w.ok, `T3 confirmed em ${secs(w.elapsed)} (≤ 5 s)`, 'confirmed em ≤ 5 s', w.value?.status);
  }

  // Passo 9 — edição: reduzir abaixo do ocupado é rejeitado; preço 150 e lotação 3 aceitos; T4; painel
  step(9);
  {
    const reduce = await orgA.postForm(`/organizer/events/${E1.id}`, eventForm({ ...E1, capacity: 1 }));
    check(
      [409, 422].includes(reduce.status) && !!attr(reduce.text, 'data-error'),
      `reduzir lotação de E1 para 1 → rejeitado (HTTP ${reduce.status}: ${attr(reduce.text, 'data-error')})`,
      'rejeição com mensagem',
      `HTTP ${reduce.status} ${snippet(reduce)}`,
    );
    let page = await managementPage(orgA, E1);
    expectEqual(textOf(page.text, /<dd data-event-capacity>([\s\S]*?)<\/dd>/), '2', 'lotação de E1 continua 2');
    Object.assign(E1, { capacity: 3, price: '150,00' });
    const edit = await orgA.postForm(`/organizer/events/${E1.id}`, eventForm(E1));
    expectStatus(edit, 303, 'preço R$ 150,00 e lotação 3 → aceito');
    page = await managementPage(orgA, E1);
    check(
      textOf(page.text, /<dd data-event-capacity>([\s\S]*?)<\/dd>/) === '3' &&
        textOf(page.text, /<dd data-event-price>([\s\S]*?)<\/dd>/) === 'R$ 150,00',
      'gestão de E1 mostra lotação 3 e preço R$ 150,00',
      'lotação 3, R$ 150,00',
      `${textOf(page.text, /<dd data-event-capacity>([\s\S]*?)<\/dd>/)}, ${textOf(page.text, /<dd data-event-price>([\s\S]*?)<\/dd>/)}`,
    );
    const res = await apiBuy(E1.id, CARD.approved);
    check(res.status === 202, `API compra T4 (...0001) → 202 (${res.json?.ticketId})`, '202', `HTTP ${res.status} ${snippet(res)}`);
    const w = await waitTicketStatus(res.json.ticketId, 'confirmed', 5000);
    check(w.ok, `T4 confirmed em ${secs(w.elapsed)}`, 'confirmed em ≤ 5 s', w.value?.status);
    expectPanel(
      await panelOf(orgA, E1),
      { confirmed: 3, pending: 0, checkins: 0, available: 0, revenue: 'R$ 350,00', refunded: 0 },
      'painel de E1: Confirmados 3, Pendentes 0, Check-ins 0, Vagas 0, Receita R$ 350,00, Estornados 0',
    );
  }

  // Passo 10 — check-in (ordem de R10)
  step(10);
  await expectCheckin(orgA, E1, C1, 'ok', MSG.ok, `check-in C1 → "${MSG.ok}"`);
  await expectCheckin(orgA, E1, C1, 'already_used', MSG.alreadyUsed, `check-in C1 de novo → "${MSG.alreadyUsed}"`);
  await expectCheckin(orgA, E1, T2.code, 'not_confirmed', MSG.notConfirmed, `check-in C2 (recusado) → "${MSG.notConfirmed}"`);
  await expectCheckin(orgA, E1, 'ZZZZZZZZ', 'invalid', MSG.invalid, `check-in ZZZZZZZZ → "${MSG.invalid}"`);
  expectPanel(await panelOf(orgA, E1), { checkins: 1, confirmed: 3 }, 'painel de E1: Check-ins 1 (Confirmados 3)');

  // Passo 11 — isolamento entre organizadores, participante e visitante
  step(11);
  let C3;
  {
    await login(orgB, SEED.orgB);
    const list = await orgB.get('/organizer');
    check(list.status === 200 && !containsEventData(list.text, E1), 'B: "Meus eventos" sem E1', 'lista sem E1', 'E1 na lista de B');
    const direct = await orgB.get(`/organizer/events/${E1.id}`);
    check(
      direct.status === 404 && !direct.text.includes(E1.name) && !direct.text.includes(E1.venue) && !/data-metric|data-form="checkin"/.test(direct.text),
      'B: URL de E1 → 404 sem nenhum dado de E1',
      '404 sem dados',
      `HTTP ${direct.status}`,
    );
    const bCheckin = await orgB.postForm(`/organizer/events/${E1.id}/checkin`, { code: C1 });
    check(bCheckin.status === 404 && !checkinResult(bCheckin.text), 'B: check-in na URL de E1 → 404 sem executar', '404', `HTTP ${bCheckin.status}`);
    const E2 = { name: `E2 e2e ${RUN}`, startsAt: nextMonthAt(11, 20), venue: `Bar E2 ${RUN}`, capacity: 1, price: '20,00' };
    await createEvent(orgB, E2);
    await publishEvent(orgB, E2);
    pass(`B cria e publica E2 (${E2.id}, lotação 1, R$ 20,00)`);
    const ev2 = await apiEvent(E2.id);
    check(ev2?.availableSeats === 1 && ev2?.priceCents === 2000, 'API lista E2 com availableSeats 1 e priceCents 2000', '{1, 2000}', JSON.stringify(ev2));
    const buy = await apiBuy(E2.id, CARD.approved);
    check(buy.status === 202, `API compra em E2 → 202 (C3 ${buy.json?.code})`, '202', `HTTP ${buy.status} ${snippet(buy)}`);
    C3 = buy.json.code;

    await login(seedParticipant, SEED.participant);
    const p = await seedParticipant.get(`/organizer/events/${E1.id}`);
    check(p.status === 403 && !containsEventData(p.text, E1), 'participante da seed: URL de E1 → 403 sem dados', '403 sem dados', `HTTP ${p.status}`);
    const v = await visitor.get(`/organizer/events/${E1.id}`);
    check(
      v.status === 302 && /^\/login/.test(v.location || '') && !containsEventData(v.text, E1),
      'visitante: URL de E1 → 302 /login sem dados',
      '302 /login',
      `HTTP ${v.status} ${v.location ?? ''}`,
    );
    await expectCheckin(orgA, E1, C3, 'invalid', MSG.invalid, `A: check-in de C3 (de E2) em E1 → "${MSG.invalid}"`);
  }

  // Passo 12 — E3, T5 (...0003) e T6 (...0001); cancelamento antes de 30 s de T5
  step(12);
  const E3 = { name: `E3 e2e ${RUN}`, startsAt: nextMonthAt(12, 19), venue: `Clube E3 ${RUN}`, capacity: 5, price: '50,00' };
  const T5 = {};
  const T6 = {};
  {
    await createEvent(orgA, E3);
    await publishEvent(orgA, E3);
    pass(`A cria e publica E3 (${E3.id}, lotação 5, R$ 50,00)`);
    const r5 = await apiBuy(E3.id, CARD.approvedSlow);
    T5.at = Date.now();
    check(r5.status === 202 && r5.json?.status === 'pending', `API compra T5 (...0003) → 202 pending (${r5.json?.ticketId})`, '202 pending', `HTTP ${r5.status} ${snippet(r5)}`);
    Object.assign(T5, { id: r5.json.ticketId, code: r5.json.code });
    const r6 = await apiBuy(E3.id, CARD.approved);
    check(r6.status === 202 && r6.json?.status === 'pending', `API compra T6 (...0001) → 202 pending (C6 ${r6.json?.code})`, '202 pending', `HTTP ${r6.status} ${snippet(r6)}`);
    Object.assign(T6, { id: r6.json.ticketId, code: r6.json.code });
    const w = await waitTicketStatus(T6.id, 'confirmed', 5000);
    check(w.ok, `T6 confirmed em ${secs(w.elapsed)}`, 'confirmed em ≤ 5 s', w.value?.status);
    const t5 = await apiTicket(T5.id);
    expectEqual(t5.status, 'pending', 'T5 ainda pending antes do cancelamento');
    const cancel = await orgA.postForm(`/organizer/events/${E3.id}/cancel`);
    E3.cancelledAt = Date.now();
    const sinceT5 = E3.cancelledAt - T5.at;
    check(
      cancel.status === 303 && sinceT5 < 30_000,
      `A cancela E3 → 303 (${secs(sinceT5)} após T5, < 30 s)`,
      '303 antes de 30 s de T5',
      `HTTP ${cancel.status} ${snippet(cancel)} em ${secs(sinceT5)}`,
    );
    const page = await managementPage(orgA, E3);
    expectEqual(eventStatus(page.text), 'cancelled', 'E3 com status cancelled na gestão');
  }

  // Passo 13 — efeitos do cancelamento
  step(13);
  {
    const showcase = await visitor.get('/');
    check(!showcaseCard(showcase.text, E3.id), 'E3 fora da vitrine', 'vitrine sem E3', 'E3 na vitrine');
    check(!(await apiEvent(E3.id)), 'E3 fora de GET /api/partner/events', 'lista sem E3', 'E3 listado');
    const buy = await apiBuy(E3.id, CARD.approved);
    check(
      buy.status === 404 && buy.json?.error === 'event_not_available',
      'compra pela API em E3 → 404 event_not_available',
      '404 event_not_available',
      `HTTP ${buy.status} ${snippet(buy)}`,
    );
    const w = await waitFor(
      async () => [(await apiTicket(T6.id)).status, (await apiTicket(T5.id)).status],
      ([s6, s5]) => s6 === 'refunded' && s5 === 'cancelled',
      Math.max(0, E3.cancelledAt + 10_000 - Date.now()),
    );
    check(w.ok, `T6 refunded e T5 cancelled (${secs(Date.now() - E3.cancelledAt)} após o cancelamento, ≤ 10 s)`, 'T6 refunded, T5 cancelled', `T6 ${w.value[0]}, T5 ${w.value[1]}`);
    const page = await managementPage(orgA, E3);
    check(
      !/data-form="edit-event"/.test(page.text) && !/data-form="publish"/.test(page.text) && !/data-form="cancel-event"/.test(page.text),
      'gestão de E3 sem formulário de edição, publicação ou cancelamento',
      'sem formulários',
      'formulário presente',
    );
    const edit = await orgA.postForm(`/organizer/events/${E3.id}`, eventForm({ ...E3, price: '60,00' }));
    expectStatus(edit, 409, 'edição de E3 pelo servidor → 409');
    const publish = await orgA.postForm(`/organizer/events/${E3.id}/publish`);
    expectStatus(publish, 409, 'republicação de E3 → 409');
  }

  // Passo 14 — resposta tardia do gateway não muda nada
  step(14);
  {
    const wait = T5.at + 45_000 - Date.now();
    console.log(`  … aguardando ${secs(wait)} (45 s após T5)`);
    await sleep(wait);
    expectEqual((await apiTicket(T5.id)).status, 'cancelled', 'T5 continua cancelled após 45 s (aprovação tardia ignorada)');
    expectEqual((await apiTicket(T6.id)).status, 'refunded', 'T6 continua refunded');
    await expectCheckin(orgA, E3, T6.code, 'event_cancelled', MSG.cancelled, `check-in C6 em E3 → "${MSG.cancelled}"`);
    expectPanel(
      await panelOf(orgA, E3),
      { confirmed: 0, pending: 0, checkins: 0, available: 0, revenue: 'R$ 0,00', refunded: 1 },
      'painel de E3: Confirmados 0, Pendentes 0, Check-ins 0, Vagas 0, Receita R$ 0,00, Estornados 1',
    );
  }

  // Passo 15 — concorrência: 30 compras simultâneas em E4 e E5 (lotação 5)
  step(15);
  for (const label of ['E4', 'E5']) {
    const ev = { name: `${label} e2e ${RUN}`, startsAt: nextMonthAt(label === 'E4' ? 13 : 14, 21), venue: `Arena ${label} ${RUN}`, capacity: 5, price: '10,00' };
    await createEvent(orgA, ev);
    await publishEvent(orgA, ev);
    pass(`A cria e publica ${label} (${ev.id}, lotação 5, R$ 10,00)`);
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) => apiBuy(ev.id, CARD.approved, `carga${i + 1}-${label.toLowerCase()}-${RUN}@example.com`)),
    );
    const count = (s) => results.filter((r) => r.status === s).length;
    const ok409 = results.filter((r) => r.status === 409).every((r) => r.json?.error === 'sold_out');
    const summary = Object.entries(results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {}))
      .map(([s, n]) => `${n}×${s}`)
      .join(' + ');
    check(count(202) === 5 && count(409) === 25 && ok409, `${label}: 30 compras simultâneas → ${summary}`, '5×202 + 25×409 sold_out', summary);
    const w = await waitFor(() => panelOf(orgA, ev), (p) => p.confirmed === '5' && p.available === '0', 10_000);
    check(w.ok, `${label}: painel Confirmados 5 e Vagas 0 em ${secs(w.elapsed)} (≤ 10 s)`, 'Confirmados 5, Vagas 0', `Confirmados ${w.value.confirmed}, Vagas ${w.value.available}`);
  }

  // Passo 16 — autenticação e erros da API
  step(16);
  {
    const anyEvent = (await apiEvents())[0]?.id ?? E1.id;
    const routes = [
      ['GET', '/api/partner/events'],
      ['POST', `/api/partner/events/${anyEvent}/purchases`],
      ['GET', `/api/partner/tickets/${T3.ticketId}`],
    ];
    for (const [label, headers] of [
      ['sem chave', {}],
      ['com chave errada', { 'X-Api-Key': `${KEY}-errada` }],
    ]) {
      for (const [method, path] of routes) {
        const res =
          method === 'GET'
            ? await api.get(path, headers)
            : await api.postJson(path, { buyerEmail: 'x@example.com', cardNumber: CARD.approved }, headers);
        check(
          res.status === 401 && res.json?.error === 'unauthorized',
          `${method} ${path.replace(/evt_\w+|tkt_\w+/, ':id')} ${label} → 401 unauthorized`,
          '401 unauthorized',
          `HTTP ${res.status} ${snippet(res)}`,
        );
      }
    }
    const bad = await api.postJson(`/api/partner/events/${anyEvent}/purchases`, { buyerEmail: 'x@example.com', cardNumber: '123' }, apiHeaders);
    check(bad.status === 422 && bad.json?.error === 'invalid_request', 'cardNumber "123" → 422 invalid_request', '422 invalid_request', `HTTP ${bad.status} ${snippet(bad)}`);
    const missing = await api.get('/api/partner/tickets/tkt_naoexiste00', apiHeaders);
    check(
      missing.status === 404 && missing.json?.error === 'ticket_not_found',
      'ticket inexistente → 404 ticket_not_found',
      '404 ticket_not_found',
      `HTTP ${missing.status} ${snippet(missing)}`,
    );
  }

  console.log(`\nFluxo completo: passos 2–16 verdes em ${secs(Date.now() - startedAt)}.`);
}

main().then(
  () => process.exit(0),
  (err) => {
    if (!(err instanceof StepFailure)) {
      console.log(`✘ passo ${currentStep} — esperado execução sem erro, obtido ${err?.cause?.code || err?.message || err}`);
    }
    console.log(`Fluxo interrompido no passo ${currentStep} após ${secs(Date.now() - startedAt)}.`);
    process.exit(1);
  },
);
