# Catraca

MVP de venda de ingressos para eventos pequenos, construído em modo agente. Fonte da verdade: `docs/PRD.md`;
estado das features: `docs/state.json`; instruções para agentes: `AGENTS.md`.

## Como rodar

Pré-requisitos: Docker (com Compose v2.17+) em execução, Git e Node.js LTS. Não é preciso `npm install` nem `.env`.

```bash
./scripts/up.sh       # sobe banco + app (migra e roda a seed automaticamente)   — ou: npm run up
./scripts/down.sh     # derruba tudo (mantém os dados); --clean apaga o volume     — ou: npm run down
./scripts/gates.sh    # sintaxe + testes automatizados em ambiente isolado         — ou: npm run gates
npm run e2e           # fluxo ponta a ponta contra o ambiente de pé (entregue na F07)
```

Porta ocupada ou outro ambiente de pé: `PORT=3100 COMPOSE_PROJECT_NAME=catraca-2 ./scripts/up.sh`
(e `COMPOSE_PROJECT_NAME=catraca-2 ./scripts/down.sh` para derrubar).

## Endereços

| | URL |
|---|---|
| WEB | http://localhost:3000 |
| API | http://localhost:3000 (API de parceiros em `/api/partner`) |
| Health | http://localhost:3000/health |

O Postgres não é exposto no host (acesso: `docker compose exec db psql -U catraca catraca`).

## Credenciais (seed)

| Papel | E-mail | Senha |
|---|---|---|
| Organizador A | `org.a@catraca.dev` | `catraca123` |
| Organizador B | `org.b@catraca.dev` | `catraca123` |
| Participante | `participante@catraca.dev` | `catraca123` |

Chave da API de parceiros (header `X-Api-Key`): `catraca-parceiro-dev` (variável `PARTNER_API_KEY`).

Participantes também podem criar a própria conta em `/signup`. Organizadores existem só pela seed.

Área do organizador: entre como organizador e acesse `/organizer` ("Meus eventos") para criar eventos (nascem como
rascunho), editar e publicar cada um na página de gestão `/organizer/events/:id`. Só eventos publicados aparecem na
vitrine (`/`). Cada organizador vê e opera apenas os próprios eventos.

## API de parceiros

JSON em `/api/partner`, autenticada pelo header `X-Api-Key: catraca-parceiro-dev` (sem chave ou errada → `401 {"error":"unauthorized"}`).

```bash
API=http://localhost:3000; KEY=catraca-parceiro-dev
curl -s "$API/api/partner/events" -H "X-Api-Key: $KEY"
# → [{"id":"evt_...","name":"...","startsAt":"2026-12-05T21:00:00-03:00","priceCents":10000,"availableSeats":2}]
curl -s -X POST "$API/api/partner/events/<eventId>/purchases" -H "X-Api-Key: $KEY" \
  -H "Content-Type: application/json" -d '{"buyerEmail":"cliente@example.com","cardNumber":"4000000000000001"}'
# → 202 {"ticketId":"tkt_...","code":"K7Q2M9XA","status":"pending"} | 422 invalid_request | 404 event_not_available | 409 sold_out
curl -s "$API/api/partner/tickets/<ticketId>" -H "X-Api-Key: $KEY"
# → {"ticketId":"tkt_...","code":"...","eventId":"evt_...","status":"confirmed","checkedIn":false} | 404 ticket_not_found
```

## Configuração

| Variável | Padrão | Uso |
|---|---|---|
| `PORT` | `3000` | porta publicada no host |
| `COMPOSE_PROJECT_NAME` | `catraca` | nome do projeto Compose (ambientes paralelos) |
| `PARTNER_API_KEY` | `catraca-parceiro-dev` | chave da API de parceiros |
| `GATEWAY_DELAY_SCALE` | `1` | multiplica os atrasos do gateway simulado (os testes usam `0.01`) |
