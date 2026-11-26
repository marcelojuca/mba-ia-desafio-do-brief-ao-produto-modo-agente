// Mensagem flash para o padrão POST → redirect 303 → GET.
//   setFlash(res, 'Evento publicado'); res.redirect(303, '/organizer/events/123');
// A próxima página renderizada com render() mostra a mensagem em <p data-notice> e o cookie é apagado.
// Também aceita ?msg=... na URL (útil para clientes sem cookie).

const COOKIE = 'catraca_flash';

export function setFlash(res, message) {
  res.cookie(COOKIE, String(message), { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60_000 });
}

export function readFlash(req, res) {
  if (req._flashRead !== undefined) return req._flashRead;
  let message = null;
  const fromCookie = req.cookies?.[COOKIE];
  if (fromCookie) {
    message = fromCookie;
    if (!res.headersSent) res.clearCookie(COOKIE, { path: '/' });
  } else if (typeof req.query?.msg === 'string' && req.query.msg.trim()) {
    message = req.query.msg.trim().slice(0, 300);
  }
  req._flashRead = message;
  return message;
}
