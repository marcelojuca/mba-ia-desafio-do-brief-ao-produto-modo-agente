# Spec F01 — Fundação, harness e contas

PRD: `docs/PRD.md` § F01. Critérios: F01-AC01..AC06 (e provê o que CF-01 e CF-02 exercitam).

## Decisões técnicas (valem para o projeto todo)

| Tema | Decisão | Por quê |
|---|---|---|
| Runtime | Node.js 22 (ESM, JavaScript puro, sem build) | A máquina do avaliador tem Node; sem etapa de build, menos coisa para quebrar. |
| HTTP | Express 4 | Simples, maduro, server-side rendering com template strings. |
| UI | HTML renderizado no servidor (template literals), formulários `POST` + redirect | Nenhum critério avalia design; sem bundler; testável por HTTP puro. |
| Banco | PostgreSQL 16 em container (`postgres:16-alpine`) | Transações e `SELECT ... FOR UPDATE` para garantir R07. |
| Driver | `pg` (node-postgres), SQL direto, sem ORM | Controle explícito de locks e transações. |
| Migrações | Arquivos `src/db/migrations/NNNN_nome.sql` aplicados em ordem; tabela `schema_migrations` | Sem dependência extra; números pré-alocados por feature evitam conflito na wave paralela (F02=0002, F03=0003, F05=0005, F06=0006). |
| Senha | `crypto.scrypt` com salt aleatório (`scrypt$<salt>$<hash>`) | Nativo do Node, sem dependência nativa. |
| Sessão | Tabela `sessions` (token aleatório 32 bytes hex), cookie `catraca_session` HttpOnly, SameSite=Lax, 7 dias | Sobrevive a restart; logout apaga a linha. |
| Papéis | `users.role` ∈ `participant`, `organizer`. Cadastro só cria `participant`. | Organizador vem só da seed. |
| Testes | `node:test` + `assert`, app subindo em porta efêmera dentro do processo de teste, banco de teste próprio | Sem dev-dependencies; roda dentro do container de gates. |
| Container | Imagem única `Dockerfile` (node:22-alpine). `docker-compose.yml`: `db` + `app`. App escuta 3000, publicado em `${PORT:-3000}`; Postgres **não** publica porta no host. | Uma porta só no host; worktrees paralelas sobem com `PORT` diferente e nome de projeto diferente. |
| Gates | `docker-compose.gates.yml` com projeto `catraca-gates` (db próprio, sem volumes nomeados) rodando `npm run check && npm test`; derrubado com `down -v` ao fim | Isolado do ambiente de pé; nada fica rodando. |
| Fuso | `TZ=America/Sao_Paulo` no container; datas aceitas/exibidas em −03:00 | Brasil sem horário de verão; `startsAt` da API sai como `2026-12-05T21:00:00-03:00`. |
| Config | Só `src/config.js` lê `process.env` | Ponto único de configuração. |

## Estrutura de pastas

```
src/main.js              # entrypoint do container: migra, roda seed, sobe servidor (e workers registrados)
src/app.js               # createApp(): express, parsers, sessão, rotas (registro central de routers)
src/config.js            # PORT, DATABASE_URL, PARTNER_API_KEY, GATEWAY_DELAY_SCALE, NODE_ENV
src/db/pool.js           # pool pg + withTransaction(fn)
src/db/migrate.js        # runner de migrações (também CLI: node src/db/migrate.js)
src/db/seed.js           # seed idempotente (também CLI)
src/db/migrations/0001_users_sessions.sql
src/web/html.js          # html`` com escape, escapeHtml, formatBRL, formatDateTime
src/web/layout.js        # render(res, { title, body, status }) com nav por papel e flash
src/auth/password.js     # hashPassword / verifyPassword
src/auth/sessions.js     # createSession / destroySession / loadSession middleware
src/auth/middleware.js   # requireLogin, requireRole(role)
src/auth/routes.js       # GET/POST /signup, /login, POST /logout
src/background.js        # registerBackgroundJob(name, startFn) — usado por F03 (worker do gateway)
test/helpers/db.js       # resetDb() (TRUNCATE ... RESTART IDENTITY CASCADE + seed)
test/helpers/server.js   # startTestServer() → { baseUrl, close }
test/helpers/client.js   # cliente HTTP com cookie jar: get/post(form)/postJson, login(email, senha)
test/*.test.js
scripts/up.sh down.sh gates.sh
```

## Modelo de dados (0001)

```sql
users(id text pk 'usr_*', name text not null, email text unique not null (minúsculo), password_hash text not null,
      role text not null check (role in ('participant','organizer')), created_at timestamptz default now())
sessions(token text pk, user_id text fk users on delete cascade, expires_at timestamptz not null, created_at)
schema_migrations(name text pk, applied_at timestamptz default now())
```

IDs são strings com prefixo + 12 caracteres aleatórios base36 (`usr_`, `evt_`, `tkt_`, `pay_`) gerados por `src/ids.js` (`newId(prefix)`).

## Seed (credenciais fixas, documentadas no README)

| Papel | Nome | E-mail | Senha |
|---|---|---|---|
| Organizador A | Organizador A | `org.a@catraca.dev` | `catraca123` |
| Organizador B | Organizador B | `org.b@catraca.dev` | `catraca123` |
| Participante | Participante Seed | `participante@catraca.dev` | `catraca123` |

Idempotência: `INSERT ... ON CONFLICT (email) DO NOTHING`. A seed não cria eventos.

## Telas e rotas

| Rota | Quem | Comportamento |
|---|---|---|
| `GET /health` | todos | `200 {"ok":true}` após banco acessível |
| `GET /signup`, `POST /signup` | visitante | nome, e-mail, senha (mín. 6); erro 422 re-renderiza com mensagem; sucesso cria participante, loga e redireciona para `/` |
| `GET /login`, `POST /login` | visitante | credencial inválida → 401 com "E-mail ou senha inválidos"; sucesso: organizador → `/organizer`, participante → `/` |
| `POST /logout` | logado | apaga sessão, limpa cookie, redireciona `/` |
| `GET /` | todos | placeholder da vitrine (F02 substitui) |

Layout: cabeçalho com "Catraca", links por papel (visitante: Vitrine, Entrar, Criar conta; participante: Vitrine, Meus ingressos, Sair; organizador: Vitrine, Meus eventos, Sair) e o nome do usuário logado. `requireRole` responde 302 para `/login` sem sessão e **403** com página "Acesso negado" para papel errado.

## Comandos do harness

- `./scripts/up.sh` — `docker compose up -d --build --wait`; o serviço `app` só fica healthy depois de migrar e rodar a seed. Imprime `$WEB`/`$API`. Aceita `PORT` e `COMPOSE_PROJECT_NAME` do ambiente.
- `./scripts/down.sh` — `docker compose down --remove-orphans` (mantém o volume do banco; `--clean` também remove volumes).
- `./scripts/gates.sh` — sobe projeto `catraca-gates` com `docker-compose.gates.yml`, roda `npm run check` (sintaxe de todos os `.js`/`.mjs` com `node --check`) e `npm test`, propaga o exit code e sempre faz `down -v`.
- `npm run up|down|gates|e2e` são atalhos (não exigem `npm install` no host).
- Variáveis: `GATEWAY_DELAY_SCALE` (padrão `1`; testes usam `0.01`) — usado por F03.

## AGENTS.md

Porta de entrada: comandos, regras do projeto (só `config.js` lê env; SQL só em módulos `*/repo.js` ou serviços; toda feature nova registra rotas em `src/app.js`; migrações com número pré-alocado; não editar relatórios de avaliação; avaliação sempre por agente separado), mapa dos artefatos, fluxo de trabalho por feature. `CLAUDE.md` contém apenas `@AGENTS.md` e uma linha apontando para ele.

## Riscos

- Porta 3000 ocupada no host → `PORT=3100 ./scripts/up.sh`.
- `docker compose --wait` exige Compose v2.17+ (Docker Desktop atual atende).
