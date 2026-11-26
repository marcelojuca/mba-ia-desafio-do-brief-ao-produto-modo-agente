# Contrato F01 — Fundação, harness e contas

Acordo entre implementador e avaliador. O avaliador exercita cada item abaixo e registra veredito com evidência.

## Pré-requisitos

- Docker em execução; Node.js LTS; nenhuma outra instância do projeto de pé na porta usada (`PORT`, padrão 3000).
- Clone limpo do commit avaliado (sem `node_modules`, sem `.env`).
- `$WEB = http://localhost:${PORT:-3000}`.

## Quality gates

- `./scripts/gates.sh` — exit 0, saída mostra os testes `node:test` executados (`# pass N`, `# fail 0`).

## Mapeamento critério → itens

| Critério PRD | Itens |
|---|---|
| F01-AC01 | H-UP-01 |
| F01-AC02 | H-DOWN-01, H-UP-02 |
| F01-AC03 | H-GATES-01 |
| F01-AC04 | ACC-SIGNUP-01, ACC-SIGNUP-02, ACC-LOGIN-01, ACC-LOGOUT-01, ACC-ROLE-01 |
| F01-AC05 | SEED-01, SEED-02 |
| F01-AC06 | DOC-01 |

## Itens

### H-UP-01 — subida em clone limpo
- dado: clone limpo em pasta vazia
- quando: `./scripts/up.sh`
- então: exit 0; `curl -s $WEB/health` → `{"ok":true}`; `curl -s $WEB/` → 200 com HTML contendo "Catraca"; `docker compose ps` mostra `app` e `db` healthy.

### SEED-01 — contas da seed funcionam
- quando: `POST $WEB/login` (form `email`, `password`) para `org.a@catraca.dev`, `org.b@catraca.dev` e `participante@catraca.dev` com `catraca123`
- então: cada um responde 302 com `Set-Cookie: catraca_session=...`; organizadores redirecionam para `/organizer`, participante para `/`.

### SEED-02 — seed idempotente
- quando: `docker compose exec app node src/db/seed.js` duas vezes
- então: exit 0 nas duas; `SELECT count(*) FROM users WHERE email LIKE '%@catraca.dev'` = 3.

### ACC-SIGNUP-01 — cadastro de participante
- quando: `POST /signup` com `name=Ana`, `email=ana+<rand>@example.com`, `password=segredo1`
- então: 302 para `/` com cookie de sessão; `GET /` com o cookie mostra "Ana" e "Meus ingressos"/"Sair"; no banco `role = 'participant'`.

### ACC-SIGNUP-02 — cadastro inválido
- quando: `POST /signup` com e-mail já existente (`participante@catraca.dev`); depois com e-mail mal formado; depois com senha de 3 caracteres; depois com nome vazio
- então: cada um responde 422 com mensagem de erro no HTML e nenhum usuário novo é criado; o formulário de cadastro não oferece escolha de papel.

### ACC-LOGIN-01 — login inválido
- quando: `POST /login` com senha errada
- então: 401 com "E-mail ou senha inválidos" e sem cookie de sessão.

### ACC-LOGOUT-01 — logout
- quando: logado, `POST /logout`; depois `GET /` com o cookie antigo
- então: 302 para `/`; a página não mostra mais o nome do usuário; a sessão não existe mais no banco.

### ACC-ROLE-01 — guarda de papel disponível
- quando: os testes automatizados de `requireRole` rodam (gates)
- então: sem sessão → 302 `/login`; papel errado → 403 "Acesso negado" (teste nomeado `requireRole` passa na saída do gates).

### H-GATES-01 — gates
- quando: `./scripts/gates.sh`
- então: exit 0; saída contém `# fail 0` e ao menos um teste de contas; após o término `docker ps --filter name=catraca-gates` vazio.

### H-DOWN-01 — derrubar
- quando: `./scripts/down.sh`
- então: exit 0; `curl -s -m 3 $WEB/health` falha (conexão recusada); `docker ps --filter label=com.docker.compose.project=<projeto>` vazio.

### H-UP-02 — subir de novo
- quando: `./scripts/up.sh` após H-DOWN-01
- então: exit 0, `/health` ok, SEED-01 continua passando (seed rodou de novo sem erro).

### DOC-01 — AGENTS.md
- então: `AGENTS.md` na raiz contém `./scripts/up.sh`, `./scripts/down.sh`, `./scripts/gates.sh`, regras do projeto e o mapa dos artefatos (PRD, `docs/features/`, `docs/state.json`); `CLAUDE.md` existe e aponta para `AGENTS.md`.
