# Spec F03 — Compra de ingressos e gateway simulado

PRD: `docs/PRD.md` § F03. Critérios: F03-AC01..AC08, CF-02, CF-03, CF-04. Regras: R03, R05, R06, R07, R08, R09.
Base: F01 (contas, banco, background jobs) e F02 (eventos, vitrine, ganchos de edição).

## Modelo de dados (migração `0003_tickets_payments.sql`)

```sql
tickets(
  id text primary key,                          -- 'tkt_' + 12 base36
  event_id text not null references events(id),
  user_id text references users(id),            -- null para compras do parceiro
  buyer_email text not null,
  code text not null unique,                    -- 8 caracteres [A-Z0-9] sem ambíguos (0,O,1,I,L)
  status text not null default 'pending'
    check (status in ('pending','confirmed','declined','cancelled','refunded')),
  price_cents integer not null check (price_cents > 0),   -- preço vigente no momento da compra (R03, R12)
  channel text not null check (channel in ('web','partner')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on tickets(event_id, status);
create index on tickets(user_id);

payment_attempts(
  id text primary key,                          -- 'pay_*'
  ticket_id text not null unique references tickets(id),
  card_last4 text not null,
  outcome text not null check (outcome in ('approved','declined')),
  respond_at timestamptz not null,              -- quando o gateway "responde"
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create index on payment_attempts(respond_at) where processed_at is null;
```

## Garantia de R07 (lotação sob concorrência)

`purchaseTicket` roda numa única transação:

1. Validação de entrada **antes** de abrir transação: e-mail (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) e cartão (`/^\d{16}$/`) → `invalid_request`.
2. `SELECT * FROM events WHERE id = $1 FOR UPDATE` — lock exclusivo da linha do evento. Compras do mesmo evento serializam aqui; compras de eventos diferentes não se bloqueiam.
3. Evento inexistente ou `status <> 'published'` → `event_not_available`.
4. `occupied = count(*) FROM tickets WHERE event_id = $1 AND status IN ('pending','confirmed')`; `occupied >= capacity` → `sold_out`.
5. `INSERT` do ingresso `pending` com `price_cents = event.price_cents` e código único (retry em colisão via `ON CONFLICT (code) DO NOTHING`, até 5 tentativas).
6. `INSERT` em `payment_attempts` com a decisão do gateway simulado e `respond_at = now() + delay`.
7. `COMMIT` e retorno imediato (não espera o gateway).

Como a edição de lotação (validador R03) e o cancelamento (F06) também pegam `FOR UPDATE` na mesma linha, os três ficam serializados por evento. Prova: teste automatizado que dispara 30 compras simultâneas (pool com várias conexões) em evento de lotação 5 e verifica exatamente 5 sucessos e 25 `sold_out`, repetido 5 vezes em eventos novos.

## Gateway simulado (`src/gateway/`)

- `simulated.js` — `decide(cardNumber, random = Math.random)` → `{ outcome, delayMs }`:

| Final | outcome | delay |
|---|---|---|
| `0001` | approved | 2000–4800 ms |
| `0002` | declined | 2000–5000 ms |
| `0003` | approved | 30000–40000 ms |
| `0004` | declined | 30000–40000 ms |
| outro | declined | 2000–5000 ms |

  `delayMs` final = sorteio × `config.gatewayDelayScale` (`GATEWAY_DELAY_SCALE`, padrão `1`; só os testes usam valor menor). O teto 4800 ms para 0001 deixa folga para o intervalo do worker e mantém o "confirmado em até 5 s".
- `worker.js` — job registrado em `registerBackgroundJob` (F01). A cada 200 ms (e também num `setTimeout` agendado para o `respond_at` de cada compra recém-criada), numa transação: `SELECT ... FROM payment_attempts WHERE processed_at IS NULL AND respond_at <= now() ORDER BY respond_at FOR UPDATE SKIP LOCKED LIMIT 50`; para cada uma, `UPDATE tickets SET status = <confirmed|declined>, updated_at = now() WHERE id = $1 AND status = 'pending'` e marca `processed_at`. O `AND status = 'pending'` é a guarda de R11: resposta que chega depois de o ingresso virar `cancelled`/`refunded` não muda nada. Como a resposta está persistida, reiniciar o app não perde respostas.
- Exporta `startGatewayWorker()` / `stopGatewayWorker()` (testes) e `processDueAttempts()` (chamável nos testes).

## Módulo `src/tickets/`

- `status.js` — `TICKET_STATUS_LABELS = { pending:'pendente', confirmed:'confirmado', declined:'recusado', cancelled:'cancelado', refunded:'estornado' }`, `ticketStatusLabel(s)`.
- `code.js` — `generateTicketCode()`.
- `availability.js` — `occupiedSeats(client, eventId)`, `getAvailability(eventId, client?)` → `{ capacity, occupied, available }`; `available = 0` se evento `cancelled`; nunca negativo.
- `purchase.js` — `purchaseTicket({ eventId, userId = null, buyerEmail, cardNumber, channel })` → `{ ok: true, ticket }` ou `{ ok: false, error: 'invalid_request'|'event_not_available'|'sold_out' }`.
- `repo.js` — `getTicketById(id)`, `listTicketsByUser(userId)` (com nome e data do evento).
- `capacity-validator.js` — registra em `registerEditValidator` (F02): se `next.capacity < occupiedSeats` → "A lotação não pode ser menor que as vagas ocupadas (N)".

## Telas

| Rota | Quem | Comportamento |
|---|---|---|
| `GET /` (vitrine, estende F02) | todos | cada evento mostra "Vagas disponíveis: N". Se `available = 0`: texto **"Ingressos esgotados"** no lugar do formulário. Se há vaga: participante vê formulário `cardNumber` + botão "Comprar"; visitante vê "Entre como participante para comprar"; organizador não vê formulário. |
| `POST /events/:id/purchase` | participante (`requireRole('participant')`) | chama `purchaseTicket` com `buyerEmail` = e-mail da conta e `channel='web'`. Sucesso → 303 para `/my-tickets` com aviso "Compra recebida, aguardando pagamento". `sold_out` → 409 com a vitrine e o aviso **"Ingressos esgotados"**. `invalid_request` → 422 "O número do cartão deve ter 16 dígitos". `event_not_available` → 404 "Evento indisponível". |
| `GET /my-tickets` | participante | tabela "Meus ingressos": Evento, Data, Status (rótulo: pendente/confirmado/recusado/cancelado/estornado), Código. Só ingressos com `user_id` da sessão. Vazia → "Você ainda não tem ingressos". |

## Ganchos de teste no HTML
- Em `/my-tickets`, cada linha `<tr data-ticket-code="<code>" data-ticket-status="<valor da API>" data-event-id="<id>">`.
- Na vitrine, dentro de `data-event-id`, o texto "Ingressos esgotados" ou o `<form action="/events/<id>/purchase">`.

## Configuração
- `GATEWAY_DELAY_SCALE` (padrão 1). Não há `GATEWAY_MODE` real: o único gateway é o simulado; nenhuma chave é lida.
