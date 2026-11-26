# Spec F05 — Check-in e painel

PRD: `docs/PRD.md` § F05. Critérios: F05-AC01..AC04, CF-07, CF-08. Regras: R03, R05, R10, R12, R13.
Base: F02 (página de gestão, `loadOwnedEvent`, `registerManagementSection`, `renderManagementPage`) e F03 (tickets, `getAvailability`).
Wave 4 (paralela a F04 e F06): **não depende** de F06; o status `cancelled` do evento já existe no schema de F02 e os status `refunded`/`cancelled` do ingresso no de F03. Os testes criam esses estados direto no banco.

## Migração `0005_checkin.sql`
```sql
alter table tickets add column checked_in_at timestamptz;
```

## Check-in (`src/checkin/`)

Seção registrada `registerManagementSection({ id: 'checkin', order: 20, ... })`: formulário `POST /organizer/events/:id/checkin` com campo `code` e botão "Validar ingresso". O campo fica disponível também em evento cancelado (a lista de R10 vale; o código válido desse evento resulta em "Evento cancelado").

`checkIn(eventId, rawCode)` — normaliza `code` (trim + maiúsculas) e, numa transação:
1. `SELECT status FROM events WHERE id = $1 FOR SHARE` (serializa com o cancelamento de F06, que usa `FOR UPDATE`).
2. `SELECT ... FROM tickets WHERE code = $code AND event_id = $1 FOR UPDATE`.
3. Primeira situação verdadeira, nesta ordem:
   1. ingresso não encontrado (código inexistente **ou** de outro evento) → **`Ingresso inválido para este evento`**
   2. evento `cancelled` → **`Evento cancelado`**
   3. `ticket.status <> 'confirmed'` → **`Ingresso não confirmado`**
   4. `checked_in_at IS NOT NULL` → **`Ingresso já utilizado`**
   5. senão `UPDATE tickets SET checked_in_at = now()` → **`Entrada liberada`**
O `FOR UPDATE` no ingresso garante que dois check-ins simultâneos do mesmo código liberem a entrada uma única vez.

Resposta: `renderManagementPage` com status 200 e o resultado num elemento `<p data-checkin-result="<chave>">MENSAGEM</p>` (chaves: `invalid`, `event_cancelled`, `not_confirmed`, `already_used`, `ok`). Rota protegida por `requireRole('organizer')` + `loadOwnedEvent` (organizador B na URL de A → 404 sem dados, sem executar o check-in).

## Painel (`src/panel/`)

Seção `registerManagementSection({ id: 'panel', order: 10, ... })`, título "Painel". Uma consulta agregada:

```sql
select
  count(*) filter (where status = 'confirmed')                              as confirmed,
  count(*) filter (where status = 'pending')                                as pending,
  count(*) filter (where status = 'confirmed' and checked_in_at is not null) as checkins,
  coalesce(sum(price_cents) filter (where status = 'confirmed'), 0)         as revenue_cents,
  count(*) filter (where status = 'refunded')                               as refunded
from tickets where event_id = $1
```
+ `getAvailability(eventId).available` (F03) para "Vagas disponíveis".

| Rótulo exibido | Elemento |
|---|---|
| Confirmados | `<dd data-metric="confirmed">3</dd>` |
| Pendentes | `data-metric="pending"` |
| Check-ins | `data-metric="checkins"` |
| Vagas disponíveis | `data-metric="available"` |
| Receita | `data-metric="revenue"` → `R$ 350,00` (`formatBRL`) |
| Estornados | `data-metric="refunded"` |

Conta todos os canais (`web` e `partner`) porque lê a tabela `tickets` inteira do evento. Receita usa `tickets.price_cents` (preço do momento da compra), nunca `events.price_cents`.

## Testes
`test/checkin.test.js` e `test/panel.test.js`: cada mensagem de R10 (incluindo código de outro evento, evento cancelado com ingresso confirmado — precedência de "Evento cancelado" sobre "não confirmado"/"já utilizado"), check-in concorrente (10 POSTs simultâneos → 1 "Entrada liberada"), painel com mistura de status e canais, receita com dois preços, estornado fora da receita, organizador B → 404.
