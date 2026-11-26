// Cliente HTTP de teste com cookie jar (fetch nativo, redirect: 'manual').
//
//   const c = createClient(baseUrl);
//   await c.login('org.a@catraca.dev', 'catraca123');
//   const r = await c.get('/organizer');   // { status, headers, location, text, json, cookies }
//   await c.postForm('/organizer/events', { name: 'Show' });
//   await c.postJson('/api/partner/events/x/purchases', { ... }, { 'X-Api-Key': 'k' });

export const SEED_PASSWORD = 'catraca123';
export const SEED = Object.freeze({
  orgA: 'org.a@catraca.dev',
  orgB: 'org.b@catraca.dev',
  participant: 'participante@catraca.dev',
});

function parseSetCookie(header) {
  const [pair, ...attrs] = header.split(';');
  const i = pair.indexOf('=');
  const name = pair.slice(0, i).trim();
  const value = pair.slice(i + 1).trim();
  let expired = value === '';
  for (const attr of attrs) {
    const [k, v = ''] = attr.trim().split('=');
    const key = k.toLowerCase();
    if (key === 'max-age' && Number(v) <= 0) expired = true;
    if (key === 'expires' && new Date(v).getTime() <= Date.now()) expired = true;
  }
  return { name, value, expired };
}

export function createClient(baseUrl) {
  const jar = new Map();

  function cookieHeader() {
    return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  function storeCookies(res) {
    for (const header of res.headers.getSetCookie()) {
      const { name, value, expired } = parseSetCookie(header);
      if (expired) jar.delete(name);
      else jar.set(name, value);
    }
  }

  async function request(method, path, { body, headers = {} } = {}) {
    const h = { ...headers };
    const cookie = cookieHeader();
    if (cookie && !('cookie' in h) && !('Cookie' in h)) h.cookie = cookie;
    const res = await fetch(new URL(path, baseUrl), { method, headers: h, body, redirect: 'manual' });
    storeCookies(res);
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return {
      status: res.status,
      headers: res.headers,
      location: res.headers.get('location'),
      setCookies: res.headers.getSetCookie(),
      text,
      json,
    };
  }

  return {
    jar,
    request,
    cookie: (name) => jar.get(name),
    clearCookies: () => jar.clear(),
    get: (path, opts) => request('GET', path, opts),
    postForm: (path, data = {}, headers = {}) =>
      request('POST', path, {
        body: new URLSearchParams(data).toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
      }),
    postJson: (path, data, headers = {}) =>
      request('POST', path, {
        body: typeof data === 'string' ? data : JSON.stringify(data),
        headers: { 'content-type': 'application/json', ...headers },
      }),
    async login(email, password = SEED_PASSWORD) {
      const res = await this.postForm('/login', { email, password });
      if (res.status !== 302) throw new Error(`login de ${email} falhou: HTTP ${res.status}`);
      return res;
    },
    logout() {
      return this.postForm('/logout');
    },
  };
}
