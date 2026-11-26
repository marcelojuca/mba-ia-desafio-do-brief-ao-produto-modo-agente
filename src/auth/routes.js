import { Router } from 'express';
import { html } from '../web/html.js';
import { render } from '../web/layout.js';
import { newId } from '../ids.js';
import { hashPassword, verifyPassword } from './password.js';
import { createSession, destroySession } from './sessions.js';
import { findUserByEmail, insertUser } from './repo.js';

export const authRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 6;

function homeFor(user) {
  return user.role === 'organizer' ? '/organizer' : '/';
}

function str(value) {
  return typeof value === 'string' ? value : '';
}

function fieldError(errors, name) {
  return errors[name] ? html`<p class="field-error" data-field-error="${name}">${errors[name]}</p>` : '';
}

// ---------------------------------------------------------------------------
// Cadastro (só cria participante)

export function validateSignup(body) {
  const name = str(body.name).trim();
  const email = str(body.email).trim().toLowerCase();
  const password = str(body.password);
  const errors = {};
  if (!name) errors.name = 'Informe seu nome';
  else if (name.length > 200) errors.name = 'Nome muito longo (máximo 200 caracteres)';
  if (!email) errors.email = 'Informe seu e-mail';
  else if (email.length > 254 || !EMAIL_RE.test(email)) errors.email = 'E-mail inválido';
  if (password.length < MIN_PASSWORD) errors.password = `A senha deve ter pelo menos ${MIN_PASSWORD} caracteres`;
  else if (password.length > 200) errors.password = 'Senha muito longa (máximo 200 caracteres)';
  return { value: { name, email, password }, errors };
}

function signupPage(res, { status = 200, values = {}, errors = {}, error = null } = {}) {
  render(res, {
    status,
    title: 'Criar conta',
    error,
    body: html`
      <form class="stack" method="post" action="/signup" data-form="signup">
        <label for="name">Nome</label>
        <input id="name" name="name" required maxlength="200" value="${values.name || ''}">
        ${fieldError(errors, 'name')}
        <label for="email">E-mail</label>
        <input id="email" name="email" type="email" required value="${values.email || ''}">
        ${fieldError(errors, 'email')}
        <label for="password">Senha (mínimo ${MIN_PASSWORD} caracteres)</label>
        <input id="password" name="password" type="password" required minlength="${MIN_PASSWORD}">
        ${fieldError(errors, 'password')}
        <button type="submit">Criar conta</button>
      </form>
      <p>Já tem conta? <a href="/login">Entrar</a></p>`,
  });
}

authRouter.get('/signup', (req, res) => {
  if (req.user) return res.redirect(302, homeFor(req.user));
  signupPage(res);
});

authRouter.post('/signup', async (req, res, next) => {
  try {
    if (req.user) return res.redirect(302, homeFor(req.user));
    const { value, errors } = validateSignup(req.body || {});
    if (!errors.email && (await findUserByEmail(value.email))) errors.email = 'Este e-mail já está cadastrado';
    if (Object.keys(errors).length) {
      return signupPage(res, { status: 422, values: value, errors, error: 'Corrija os campos destacados' });
    }
    let user;
    try {
      user = await insertUser({
        id: newId('usr'),
        name: value.name,
        email: value.email,
        passwordHash: await hashPassword(value.password),
        role: 'participant', // cadastro nunca cria organizador
      });
    } catch (err) {
      if (err.code === '23505') {
        return signupPage(res, {
          status: 422,
          values: value,
          errors: { email: 'Este e-mail já está cadastrado' },
          error: 'Corrija os campos destacados',
        });
      }
      throw err;
    }
    await createSession(res, user.id);
    res.redirect(302, '/');
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Login / logout

function loginPage(res, { status = 200, email = '', error = null } = {}) {
  render(res, {
    status,
    title: 'Entrar',
    error,
    body: html`
      <form class="stack" method="post" action="/login" data-form="login">
        <label for="email">E-mail</label>
        <input id="email" name="email" type="email" required value="${email}">
        <label for="password">Senha</label>
        <input id="password" name="password" type="password" required>
        <button type="submit">Entrar</button>
      </form>
      <p>Não tem conta? <a href="/signup">Criar conta</a></p>`,
  });
}

authRouter.get('/login', (req, res) => {
  if (req.user) return res.redirect(302, homeFor(req.user));
  loginPage(res);
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const email = str(req.body?.email).trim().toLowerCase();
    const password = str(req.body?.password);
    const user = email ? await findUserByEmail(email) : null;
    const ok = user ? await verifyPassword(password, user.password_hash) : false;
    if (!ok) return loginPage(res, { status: 401, email, error: 'E-mail ou senha inválidos' });
    if (req.user) await destroySession(req, res);
    await createSession(res, user.id);
    res.redirect(302, homeFor(user));
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', async (req, res, next) => {
  try {
    await destroySession(req, res);
    res.redirect(302, '/');
  } catch (err) {
    next(err);
  }
});
