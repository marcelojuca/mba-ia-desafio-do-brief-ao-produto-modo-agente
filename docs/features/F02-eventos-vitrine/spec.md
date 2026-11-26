# Spec F02 — Eventos do organizador e vitrine

PRD: `docs/PRD.md` § F02. Critérios: F02-AC01..AC05, CF-01. Regras: R01, R02, R03 (parte de edição), R04, R13.
Base técnica: `docs/features/F01-fundacao-contas/spec.md`.

## Modelo de dados (migração `0002_events.sql`)

```sql
events(
  id text primary key,                         -- 'evt_' + 12 base36
  organizer_id text not null references users(id),
  name text not null,
  starts_at timestamptz not null,
  venue text not null,
  capacity integer not null check (capacity >= 1),
  price_cents integer not null check (price_cents > 0),
  status text not null default 'draft' check (status in ('draft','published','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on events(organizer_id);
create index on events(status);
```

`cancelled` é terminal; F02 já trata o valor (sem edição/publicação), F06 é quem faz a transição.

## Módulo `src/events/`

- `repo.js` — `insertEvent`, `updateEvent`, `findEventById(id)`, `findOwnedEvent(id, organizerId)`, `listEventsByOrganizer(organizerId)`, `listOnSaleEvents()` (status `published`, ordem `starts_at`), `lockEvent(client, id)` (`SELECT ... FOR UPDATE`).
- `validation.js` — `parseEventInput(body, now)` → `{ value }` ou `{ errors: { campo: mensagem } }`:
  - `name`, `venue`: obrigatórios, trim, até 200 caracteres.
  - `startsAt`: `datetime-local` (`YYYY-MM-DDTHH:mm`) interpretado em −03:00; precisa ser > agora (criação **e** edição). Mensagem: "A data de início precisa estar no futuro".
  - `capacity`: inteiro ≥ 1 ("Lotação deve ser um inteiro maior ou igual a 1").
  - `price`: reais aceitando `100`, `100,00`, `100.00`, `1.234,56`; convertido para centavos inteiros; > 0 ("Preço deve ser maior que zero").
- `service.js` — `createEvent(organizerId, input)`, `editEvent(event, input)` (em transação, com `lockEvent`, roda os validadores registrados), `publishEvent(event)` (só `draft` → `published`).
- `edit-validators.js` — `registerEditValidator(fn)`; `fn({ client, event, next })` retorna `null` ou mensagem de erro. F03 registra a regra de lotação (R03).
- `management-sections.js` — `registerManagementSection({ id, order, render })`; `render({ event, req, flash })` retorna HTML. F05 (check-in, painel) e F06 (cancelamento) registram seções.
- `page.js` — `renderManagementPage(req, res, { status = 200, notice, errors, values })`: renderiza a página de gestão de `req.event` (usada pelas rotas de F02 e reaproveitada por F05/F06 para mostrar resultado de ações). `notice` aparece num elemento `<p data-notice>`.
- `guard.js` — middleware `loadOwnedEvent`: exige `requireRole('organizer')`, busca por `id` **e** `organizer_id`; se não achar responde **404** com a página "Evento não encontrado" (sem nenhum dado do evento) e não diferencia "não existe" de "é de outro". Coloca o evento em `req.event`.
- `routes.js` — rotas abaixo; `showcase.js` — vitrine.

## Rotas e telas

| Rota | Comportamento |
|---|---|
| `GET /organizer` | lista os eventos do organizador logado: nome, data, status (Rascunho/Publicado/Cancelado), link para a gestão; botão "Novo evento" |
| `GET /organizer/events/new` | formulário (nome, início, local, lotação, preço em R$) |
| `POST /organizer/events` | cria como `draft` e redireciona (302) para `/organizer/events/:id`; inválido → 422 com mensagens |
| `GET /organizer/events/:id` | **página de gestão** (R04): dados do evento, status, formulário de edição (se não cancelado), botão "Publicar" (se rascunho) e as seções registradas na ordem |
| `POST /organizer/events/:id` | edição (todos os campos); inválido → 422 com mensagem na página de gestão; evento cancelado → 409 "Evento cancelado não pode ser editado" |
| `POST /organizer/events/:id/publish` | `draft` → `published`; outro status → 409 |
| `GET /` | vitrine pública: eventos `published` (nome, data, local, preço). Vazia → "Nenhum evento à venda no momento" |

Todas as rotas `/organizer*` passam por `requireRole('organizer')` (visitante → 302 `/login`; participante → 403) e as de `:id` por `loadOwnedEvent`.

Feedback das ações POST: redirect 303 com mensagem flash (`?msg=` ou cookie flash) exibida na página de gestão; erros de validação re-renderizam com 422.

## Ganchos de teste no HTML
- Vitrine: cada evento num elemento com `data-event-id="<id>"`.
- Gestão: status do evento em `data-event-status="draft|published|cancelled"`.

## Formatação
- Data: `05/12/2026 21:00`; preço: `R$ 100,00` (`formatBRL` de F01).

## Fora desta feature
- Compras, vagas e validação de lotação contra vagas ocupadas (F03), check-in/painel (F05), cancelamento (F06).
