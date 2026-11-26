import { html, raw } from './html.js';
import { readFlash } from './flash.js';

const STYLE = `
  body { font-family: system-ui, sans-serif; margin: 0; color: #1d1d1f; background: #fafafa; }
  header { background: #222; color: #fff; padding: 12px 24px; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
  header a, header button { color: #fff; }
  header .brand { font-weight: bold; font-size: 1.2em; text-decoration: none; margin-right: 8px; }
  header nav { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  header form { display: inline; margin: 0; }
  header button { background: none; border: 1px solid #fff; border-radius: 4px; padding: 2px 8px; cursor: pointer; }
  header .user { margin-left: auto; opacity: .85; }
  main { max-width: 960px; margin: 24px auto; padding: 0 16px; }
  form.stack label { display: block; margin: 12px 0 4px; }
  form.stack input { padding: 6px; width: 100%; max-width: 360px; box-sizing: border-box; }
  form.stack button { margin-top: 16px; padding: 8px 16px; }
  .notice { background: #e8f4ea; border: 1px solid #9c9; padding: 8px 12px; border-radius: 4px; }
  .error { background: #fdecec; border: 1px solid #e99; padding: 8px 12px; border-radius: 4px; }
  .field-error { color: #b00020; font-size: .9em; margin: 4px 0 0; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #ddd; }
`;

function navLinks(user) {
  if (!user) {
    return html`<a href="/">Vitrine</a> <a href="/login">Entrar</a> <a href="/signup">Criar conta</a>`;
  }
  const roleLink =
    user.role === 'organizer'
      ? html`<a href="/organizer">Meus eventos</a>`
      : html`<a href="/my-tickets">Meus ingressos</a>`;
  return html`<a href="/">Vitrine</a> ${roleLink}
    <form method="post" action="/logout"><button type="submit">Sair</button></form>`;
}

// Página completa. body é SafeHtml (html``) ou string já escapada.
export function page({ title, body, user = null, notice = null, error = null }) {
  return html`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title ? `${title} — Catraca` : 'Catraca'}</title>
<style>${raw(STYLE)}</style>
</head>
<body>
<header>
  <a class="brand" href="/">Catraca</a>
  <nav>${navLinks(user)}</nav>
  ${user ? html`<span class="user" data-user-role="${user.role}">${user.name}</span>` : ''}
</header>
<main>
  ${notice ? html`<p class="notice" data-notice>${notice}</p>` : ''}
  ${error ? html`<p class="error" data-error>${error}</p>` : ''}
  ${title ? html`<h1>${title}</h1>` : ''}
  ${body}
</main>
</body>
</html>`.toString();
}

// render(res, { title, body, status = 200, notice, error })
// Usa res.req.user para a navegação e mostra a mensagem flash pendente (setFlash) quando não há notice explícito.
export function render(res, { title, body, status = 200, notice = null, error = null } = {}) {
  const req = res.req;
  const flash = readFlash(req, res);
  res
    .status(status)
    .type('html')
    .send(page({ title, body, user: req.user || null, notice: notice ?? flash, error }));
}

export function renderError(res, status, title, message) {
  render(res, { status, title, body: html`<p>${message}</p>` });
}
