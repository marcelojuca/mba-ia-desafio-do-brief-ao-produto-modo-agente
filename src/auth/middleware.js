import { renderError } from '../web/layout.js';

// Sem sessão → 302 /login.
export function requireLogin(req, res, next) {
  if (!req.user) return res.redirect(302, '/login');
  next();
}

// requireRole('organizer') / requireRole('participant'):
// sem sessão → 302 /login; papel diferente → 403 "Acesso negado".
export function requireRole(...roles) {
  const allowed = new Set(roles.flat());
  return function requireRoleMiddleware(req, res, next) {
    if (!req.user) return res.redirect(302, '/login');
    if (!allowed.has(req.user.role)) {
      return renderError(res, 403, 'Acesso negado', 'Você não tem permissão para acessar esta página.');
    }
    next();
  };
}
