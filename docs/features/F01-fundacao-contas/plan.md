# Plano F01 — Fundação, harness e contas

Cada etapa termina com um commit `feat(F01): <etapa>`.

1. **Esqueleto Node** — `package.json` (type module, scripts `start`, `check`, `test`, `up`, `down`, `gates`, `e2e`, `seed`, `migrate`), dependências `express` e `pg`, `package-lock.json`, `.gitignore`, `.dockerignore`, `src/config.js`, `src/ids.js`.
2. **Banco** — `src/db/pool.js` (pool + `withTransaction`), `src/db/migrate.js`, `0001_users_sessions.sql`, `src/db/seed.js` idempotente.
3. **Web base** — `src/web/html.js`, `src/web/layout.js`, `src/app.js` com `/health` e vitrine placeholder, `src/main.js` (migra → seed → listen → background jobs), `src/background.js`.
4. **Contas** — senha scrypt, sessões, middlewares `requireLogin`/`requireRole`, rotas `/signup`, `/login`, `/logout`.
5. **Containers e scripts** — `Dockerfile`, `docker-compose.yml` (healthchecks, `app` depende de `db` healthy), `docker-compose.gates.yml`, `scripts/up.sh`, `scripts/down.sh`, `scripts/gates.sh` (executáveis).
6. **Testes** — helpers (`resetDb`, `startTestServer`, cliente com cookie jar) e testes: migração idempotente, seed idempotente, cadastro/login/logout, e-mail duplicado, `requireRole` (403/302), senha errada.
7. **Docs de harness** — `AGENTS.md`, `CLAUDE.md`, seção inicial do `README.md` (como rodar, endereços, credenciais).
8. **Verificação local** — `./scripts/gates.sh` verde; `./scripts/up.sh` + login das 3 contas por curl; `./scripts/down.sh` e `docker ps` vazio do projeto; subir de novo.
