# AGENTS.md — porta de entrada dos agentes

Catraca: MVP de venda de ingressos (vitrine, contas, área do organizador, compra com gateway simulado, API de parceiros).
Leia este arquivo antes de qualquer tarefa. A fonte da verdade do produto é `docs/PRD.md`.

## Comandos

| Comando | O que faz |
|---|---|
| `./scripts/up.sh` (`npm run up`) | Sobe `db` + `app` com Docker Compose (`up -d --build --wait`). O app migra, roda a seed e só então fica healthy. Imprime `WEB`/`API` (padrão `http://localhost:3000`). |
| `./scripts/down.sh` (`npm run down`) | Derruba tudo que o `up` subiu (mantém o volume do banco). `./scripts/down.sh --clean` também apaga o volume. |
| `./scripts/gates.sh` (`npm run gates`) | Quality gates: `npm run check` (sintaxe de todo `.js`/`.mjs` em `src`, `test`, `scripts`) + `npm test` (`node:test`) num projeto Compose isolado `catraca-gates` (banco próprio, sem portas no host, `GATEWAY_DELAY_SCALE=0.01`). Propaga o exit code e sempre derruba com `down -v`. |
| `npm run e2e` | Fluxo ponta a ponta do avaliador (`scripts/e2e-flow.mjs`, entregue por F07) contra o ambiente de pé. |
| `npm run migrate` / `npm run seed` | Migrações / seed idempotente (dentro do container: `docker compose exec app node src/db/seed.js`). |

Ambientes paralelos (ex.: uma worktree por feature): `COMPOSE_PROJECT_NAME=catraca-f04 PORT=3104 ./scripts/up.sh` e o mesmo
`COMPOSE_PROJECT_NAME` no `down.sh`. Só Docker e Node.js são necessários no host; `npm install` no host não é exigido.

## Regras do projeto

- Stack: Node.js 22 ESM, JavaScript puro, sem build. Dependências de runtime só `express` e `pg`; testes com `node:test` (sem dev-dependencies).
- **Só `src/config.js` lê `process.env`.** Nova variável → adicionar em `config.js` (com padrão) e no `docker-compose.yml`.
- **SQL só em módulos `*/repo.js` ou serviços** (`service.js`, `purchase.js` etc.). Rotas não montam SQL.
- Transações com `withTransaction(async (client) => ...)` de `src/db/pool.js`; locks de linha (`SELECT ... FOR UPDATE`) dentro dela.
- **Toda feature nova registra seus routers em `src/app.js`** (bloco "routers das features"), antes do 404.
- **Migrações** em `src/db/migrations/NNNN_nome.sql` com número pré-alocado por feature (F01=0001, F02=0002, F03=0003, F05=0005, F06=0006). Nunca editar uma migração já integrada na `main`; criar outra.
- IDs: `newId('usr'|'evt'|'tkt'|'pay')` de `src/ids.js` (prefixo + 12 base36).
- HTML server-side com o tagged template `html\`\`` de `src/web/html.js` (escapa tudo; `raw()` só para conteúdo do próprio código). Página completa com `render(res, { title, body, status, notice, error })` de `src/web/layout.js`. Mensagem após POST → `setFlash(res, msg)` + `res.redirect(303, ...)`.
- Formatação: `formatBRL(cents)` → `R$ 100,00`; `formatDateTime(d)` → `05/12/2026 21:00`; `formatIsoBrt(d)` → `2026-12-05T21:00:00-03:00`; `parseDateTimeLocal('2026-12-05T21:00')` interpreta em −03:00.
- Autorização: `requireLogin`, `requireRole('organizer'|'participant')` de `src/auth/middleware.js` (sem sessão → 302 `/login`; papel errado → 403 "Acesso negado"). Usuário logado em `req.user`.
- Eventos (`src/events/`, F02): rotas `/organizer/events/:id/...` usam `loadOwnedEvent` (guard de dono → `req.event`, 404 "Evento não encontrado" para evento de outro); seções da página de gestão via `registerManagementSection({ id, order, render })`; resultado de ações com `renderManagementPage(req, res, { status, notice, error })`; regras extras de edição via `registerEditValidator(({ client, event, next }) => null | 'mensagem')`; `lockEvent(client, id)` trava a linha do evento; `listOnSaleEvents()` lista os publicados.
- Ingressos (`src/tickets/`, F03): `purchaseTicket({ eventId, userId, buyerEmail, cardNumber, channel: 'web'|'partner' })` → `{ ok, ticket }` ou `{ ok: false, error: 'invalid_request'|'event_not_available'|'sold_out' }` (lock `FOR UPDATE` do evento, R07); `getAvailability(eventId, client?)` → `{ capacity, occupied, available }` (cancelado → 0; `null` se o evento não existe); `occupiedSeats(client, eventId)`; `getTicketById(id)`; `ticketStatusLabel(status)`. Gateway simulado em `src/gateway/` (`processDueAttempts()` aplica respostas vencidas só a ingressos `pending`). Vitrine: `renderShowcasePage(req, res, { status, notice, error })` de `src/events/showcase.js`.
- Jobs de background: `registerBackgroundJob(name, startFn)` de `src/background.js` (`startFn` pode retornar a função de parada).
- Textos da interface em português (pt-BR). Ganchos de teste no HTML via atributos `data-*` definidos nas specs.
- Testes em `test/*.test.js` com os helpers `test/helpers/db.js` (`resetDb`, `closeDb`), `server.js` (`startTestServer`) e `client.js` (`createClient` com cookie jar, `login`). Rodam em série (`--test-concurrency=1`) porque compartilham o banco.
- Toda mudança precisa passar em `./scripts/gates.sh` antes de commit/PR.

## Mapa dos artefatos

| Artefato | Onde |
|---|---|
| PRD (features, dependências, waves, critérios de aceite) | `docs/PRD.md` |
| Spec, plano e contrato de cada feature | `docs/features/<FXX-slug>/spec.md`, `plan.md`, `contract.md` |
| Relatórios de avaliação (imutáveis) | `docs/features/<FXX-slug>/eval-report-<timestamp>.md` |
| Estado de cada feature (status, último relatório) | `docs/state.json` (só o orquestrador edita) |
| Processo e template de avaliação | `docs/evaluation/` |
| Como rodar, endereços e credenciais | `README.md` |

## Fluxo de trabalho por feature

1. Uma branch por feature (`feat/FXX-slug`); na wave paralela (F04, F05, F06), uma worktree por feature com `COMPOSE_PROJECT_NAME`/`PORT` próprios.
2. O implementador segue `spec.md` e `plan.md`, um commit por etapa (`feat(FXX): <etapa>`), e deixa `./scripts/gates.sh` verde.
3. **Quem implementa nunca avalia.** A avaliação é feita por um agente separado, de contexto vazio, contra o `contract.md` (ver `docs/evaluation/README.md`).
4. Cada avaliação grava um `eval-report-*.md` **novo**; relatórios nunca são editados nem apagados. Reprovou → corrige → nova avaliação.
5. Feature aprovada é integrada na `main` por PR; o orquestrador atualiza `docs/state.json`.
6. Não alterar PRD, contratos ou relatórios de avaliação como parte da implementação; divergência com a spec é registrada no PR/relatório.
