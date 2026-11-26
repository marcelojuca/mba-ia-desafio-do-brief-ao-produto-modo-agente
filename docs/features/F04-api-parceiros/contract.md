# Contrato F04 — API de parceiros

## Pré-requisitos

- Ambiente de pé (`./scripts/up.sh`, modo padrão do gateway); `$API = http://localhost:${PORT:-3000}`; `$KEY = catraca-parceiro-dev`.
- Organizador A logado na interface para criar/publicar eventos (F02); participante para compra na vitrine (F03).

## Quality gates

- `./scripts/gates.sh` — exit 0, inclui `test/partner-api.test.js`.

## Mapeamento critério → itens

| Critério PRD | Itens |
|---|---|
| F04-AC01 | API-AUTH-01 |
| F04-AC02 | API-LIST-01 |
| F04-AC03 | API-BUY-01, API-ERR-01 |
| F04-AC04 | API-CONC-01 |
| F04-AC05 | API-TICKET-01, API-TICKET-02 |
| CF-05 (F02→F04) | API-LIST-01, API-ERR-01 |
| CF-06 (F03→F04) | API-BUY-01, API-TICKET-01, API-SOLDOUT-WEB-01 |

## Itens

### API-AUTH-01 — 401 sem chave ou com chave errada
- quando: as três rotas (`GET /api/partner/events`, `POST /api/partner/events/<E>/purchases` com corpo válido, `GET /api/partner/tickets/<T>`) sem `X-Api-Key` e com `X-Api-Key: errada`
- então: 6 respostas `401` com corpo exatamente `{"error":"unauthorized"}`; nenhuma compra criada.

### API-LIST-01 — listagem só com publicados (CF-05)
- quando: A cria E (lotação 2, R$ 100,00) sem publicar; `GET /api/partner/events`; A publica E pela gestão; `GET` de novo
- então: antes, E não está na lista; depois, E está com `name`, `startsAt` no formato `YYYY-MM-DDTHH:mm:ss-03:00`, `priceCents: 10000`, `availableSeats: 2` e só essas 5 chaves; `id` é string.

### API-ERR-01 — ordem dos erros da compra
- quando, com chave válida:
  - corpo `{"buyerEmail":"x@example.com","cardNumber":"123"}` em `evt_inexistente` → espera 422
  - corpo sem `buyerEmail` → 422; `buyerEmail: "nao-e-email"` → 422; corpo JSON malformado → 422
  - corpo válido em `evt_inexistente` → 404; em evento rascunho de A → 404
  - corpo válido em evento publicado sem vaga → 409
- então: corpos exatamente `{"error":"invalid_request"}`, `{"error":"event_not_available"}`, `{"error":"sold_out"}` respectivamente.

### API-BUY-01 — compra pela API ocupa vaga e passa pelo gateway de F03 (CF-06)
- quando: E publicado com lotação 2; `POST .../purchases` com `4000000000000004`; `GET /api/partner/events`; após 45 s `GET /api/partner/tickets/<T>` e `GET /api/partner/events`
- então: 202 `{ticketId, code (8 caracteres), status:"pending"}` em < 1 s; `availableSeats` de E cai para 1; após 45 s o ingresso está `declined` e `availableSeats` volta a 2.
- e: compra com `4000000000000001` → em até 5 s `GET /api/partner/tickets/<T>` mostra `confirmed`.

### API-TICKET-01 — consulta de ingresso de qualquer canal (CF-06)
- quando: participante compra E na vitrine (F03) com `4000000000000001`; pega o código em `/my-tickets` e o `tkt_` no banco; `GET /api/partner/tickets/<tkt>`
- então: 200 com exatamente `ticketId`, `code` (igual ao de "Meus ingressos"), `eventId`, `status` (`pending` ou `confirmed`) e `checkedIn: false`.

### API-TICKET-02 — ingresso inexistente
- quando: `GET /api/partner/tickets/tkt_naoexiste`
- então: 404 `{"error":"ticket_not_found"}`.

### API-SOLDOUT-WEB-01 — vagas ocupadas pela vitrine contam na API (CF-06)
- quando: E com lotação 1; participante compra na vitrine (`...0001`); `GET /api/partner/events`; `POST .../purchases`
- então: `availableSeats: 0`; a compra pela API responde 409 `sold_out`.

### API-CONC-01 — 30 compras simultâneas, duas rodadas
- quando: E4 e E5 novos, lotação 5, publicados; para cada um:
  `seq 30 | xargs -P 30 -I{} curl -s -o /dev/null -w "%{http_code}\n" -X POST "$API/api/partner/events/$E/purchases" -H "X-Api-Key: $KEY" -H "Content-Type: application/json" -d '{"buyerEmail":"carga{}@example.com","cardNumber":"4000000000000001"}' | sort | uniq -c`
- então: em cada rodada `5 202` e `25 409`; após 10 s `availableSeats: 0` e os 5 ingressos `confirmed`.
