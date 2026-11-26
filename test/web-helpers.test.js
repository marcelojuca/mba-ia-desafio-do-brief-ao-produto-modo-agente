import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  html,
  raw,
  escapeHtml,
  formatBRL,
  formatDateTime,
  formatIsoBrt,
  parseDateTimeLocal,
  toDateTimeLocal,
} from '../src/web/html.js';
import { newId } from '../src/ids.js';
import { hashPassword, verifyPassword } from '../src/auth/password.js';
import { registerBackgroundJob, startBackgroundJobs, stopBackgroundJobs } from '../src/background.js';

test('html`` escapa valores interpolados e não re-escapa html aninhado', () => {
  const name = '<script>alert("x")</script>&\'';
  const out = String(html`<p>${name}</p>${[html`<b>${'a<b'}</b>`, html`<i>c</i>`]}${raw('<hr>')}${null}${false}`);
  assert.equal(
    out,
    '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;</p><b>a&lt;b</b><i>c</i><hr>',
  );
  assert.equal(escapeHtml('"<>'), '&quot;&lt;&gt;');
});

test('formatBRL formata centavos em reais', () => {
  assert.equal(formatBRL(10000), 'R$ 100,00');
  assert.equal(formatBRL(35000), 'R$ 350,00');
  assert.equal(formatBRL(123456), 'R$ 1.234,56');
  assert.equal(formatBRL(0), 'R$ 0,00');
  assert.equal(formatBRL(5), 'R$ 0,05');
});

test('datas em −03:00: formatDateTime, formatIsoBrt, parse/toDateTimeLocal', () => {
  const d = parseDateTimeLocal('2026-12-05T21:00');
  assert.equal(d.toISOString(), '2026-12-06T00:00:00.000Z');
  assert.equal(formatDateTime(d), '05/12/2026 21:00');
  assert.equal(formatIsoBrt(d), '2026-12-05T21:00:00-03:00');
  assert.equal(toDateTimeLocal(d), '2026-12-05T21:00');
  assert.equal(parseDateTimeLocal('2026-02-31T10:00'), null);
  assert.equal(parseDateTimeLocal('amanhã'), null);
  assert.equal(parseDateTimeLocal(undefined), null);
});

test('newId gera prefixo + 12 caracteres base36', () => {
  const ids = new Set();
  for (let i = 0; i < 200; i++) {
    const id = newId('usr');
    assert.match(id, /^usr_[0-9a-z]{12}$/);
    ids.add(id);
  }
  assert.equal(ids.size, 200);
});

test('hashPassword/verifyPassword (scrypt com salt)', async () => {
  const h1 = await hashPassword('segredo1');
  const h2 = await hashPassword('segredo1');
  assert.notEqual(h1, h2);
  assert.ok(await verifyPassword('segredo1', h1));
  assert.ok(!(await verifyPassword('segredo2', h1)));
  assert.ok(!(await verifyPassword('segredo1', 'lixo')));
});

test('registerBackgroundJob: start chama startFn e stop chama a função retornada', async () => {
  const calls = [];
  registerBackgroundJob('teste', () => {
    calls.push('start');
    return () => calls.push('stop');
  });
  assert.throws(() => registerBackgroundJob('teste', () => {}), /já registrado/);
  await startBackgroundJobs({ log: () => {} });
  await startBackgroundJobs({ log: () => {} }); // não inicia duas vezes
  await stopBackgroundJobs();
  assert.deepEqual(calls, ['start', 'stop']);
});
