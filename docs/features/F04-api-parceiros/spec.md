# Spec F04 — API de parceiros

PRD: `docs/PRD.md` § F04. Critérios: F04-AC01..AC05, CF-05, CF-06. Regras: R02, R05, R06, R07, R09.
Contrato fixo do brief — não mudar nomes de campos, status HTTP nem códigos de erro.

## Decisões

- Router `src/partner/routes.js` montado em `/api/partner` em `src/app.js`, com `express.json()` próprio.
- Middleware `src/partner/auth.js`: compara `X-Api-Key` com `config.partnerApiKey` (`PARTNER_API_KEY`, padrão `catraca-parceiro-dev`) usando `crypto.timingSafeEqual`; ausente ou diferente → `401 {"error":"unauthorized"}`. Aplicado antes de qualquer outra validação, em todas as rotas (inclusive rotas inexistentes sob `/api/partner`).
- JSON inválido no corpo → 422 `invalid_request` (o erro do `express.json` é capturado e convertido).
- Sem migração: usa `events` (F02) e `tickets`/`payment_attempts` (F03).

## Rotas

### `GET /api/partner/events` → 200
`listOnSaleEvents()` (F02) + `getAvailability` (F03):
```json
[{ "id": "evt_...", "name": "Jazz no Porão", "startsAt": "2026-12-05T21:00:00-03:00", "priceCents": 10000, "availableSeats": 2 }]
```
`startsAt` formatado em −03:00 (`formatIsoBrt`). Só `status='published'`.

### `POST /api/partner/events/{eventId}/purchases` → 202
Corpo `{ "buyerEmail": string, "cardNumber": string }`. Chama `purchaseTicket({ eventId, userId: null, buyerEmail, cardNumber, channel: 'partner' })` (F03) — a mesma função da vitrine, logo a mesma transação com lock (R07).
- sucesso → `202 { "ticketId", "code", "status": "pending" }`
- `invalid_request` → 422 (campo faltando, não-string, e-mail mal formado, cartão sem exatamente 16 dígitos)
- `event_not_available` → 404 (inexistente, rascunho, cancelado)
- `sold_out` → 409
Ordem garantida pelo próprio `purchaseTicket` (validação antes da transação; evento antes de vagas).

### `GET /api/partner/tickets/{ticketId}` → 200
`getTicketById` (F03), qualquer canal:
```json
{ "ticketId": "tkt_...", "code": "K7Q2M9XA", "eventId": "evt_...", "status": "confirmed", "checkedIn": false }
```
`checkedIn` = `checked_in_at IS NOT NULL` se a coluna existir (F05 cria `tickets.checked_in_at` em paralelo). Para não depender de F05, a consulta usa `to_jsonb(t) ->> 'checked_in_at'` (retorna `null` enquanto a coluna não existir) e converte para booleano. Inexistente → `404 {"error":"ticket_not_found"}`.

## Testes
`test/partner-api.test.js`: 401 nas três rotas (sem chave, chave errada); listagem com rascunho/publicado/cancelado (cancelado inserido direto no banco); formato exato das respostas; ordem dos erros 422→404→409 (ex.: corpo inválido em evento inexistente → 422; evento rascunho sem vaga → 404); 30 compras simultâneas em lotação 5 → 5×202 e 25×409 em 2 rodadas; consulta de ingresso da vitrine e do parceiro; confirmação via worker com escala pequena.
