# Contrato F06 — Cancelamento de evento

## Pré-requisitos

- Ambiente de pé (`./scripts/up.sh`, modo padrão do gateway); `$WEB = http://localhost:${PORT:-3000}`.
- A e B logados; participantes via signup; compras pela vitrine (F03). Compras do canal `partner` pelo serviço de F03 (`docker compose exec app node -e "import('./src/tickets/purchase.js').then(...)"`) ou pela API de F04 se já integrada.
- Leitura de status pelo `/my-tickets` ou pelo banco (`docker compose exec db psql -U catraca catraca`).

## Quality gates

- `./scripts/gates.sh` — exit 0, inclui `test/cancellation.test.js`.

## Mapeamento critério → itens

| Critério PRD | Itens |
|---|---|
| F06-AC01 | CAN-ONLY-PUBLISHED-01, CAN-LOCK-EDIT-01 |
| F06-AC02 | CAN-SHOWCASE-01 |
| F06-AC03 | CAN-TRANSITIONS-01 |
| F06-AC04 | CAN-LATE-GW-01 |
| CF-09 (F02→F06) | CAN-LOCK-EDIT-01, CAN-ACL-01 |
| CF-10 (F03→F06) | CAN-TRANSITIONS-01, CAN-LATE-GW-01 |

## Itens

### CAN-ONLY-PUBLISHED-01 — só publicado cancela
- quando: A cria rascunho D; `GET /organizer/events/<D>`; `POST /organizer/events/<D>/cancel`
- então: a página de D não mostra "Cancelar evento"; o POST responde 409 e D continua rascunho.

### CAN-TRANSITIONS-01 — transições em até 10 s (CF-10)
- quando: A publica E3 (lotação 5, R$ 50,00); participante compra na vitrine com `...0003` (T5, pendente por 30–40 s) e outra compra (canal `partner`) com `...0001` (T6); espera T6 `confirmed`; A envia `POST /organizer/events/<E3>/cancel` antes de 30 s da compra de T5; lê os status em até 10 s
- então: o POST responde 303 e a gestão mostra "Evento cancelado"; T6 = `refunded` (rótulo "estornado" em `/my-tickets` quando for da vitrine); T5 = `cancelled` ("cancelado").

### CAN-LATE-GW-01 — resposta tardia do gateway não muda nada (CF-10)
- quando: após CAN-TRANSITIONS-01, esperar até 45 s depois da compra de T5
- então: T5 continua `cancelled`; T6 continua `refunded`; `payment_attempts` de T5 tem `processed_at` preenchido (o worker processou e não alterou).

### CAN-SHOWCASE-01 — sai da vitrine e não vende
- quando: deslogado `GET /`; participante `POST /events/<E3>/purchase` com `...0001`
- então: E3 não aparece na vitrine; o POST responde 404 "Evento indisponível" e nenhum ingresso novo é criado; `getAvailability(E3).available = 0` (teste do gates).

### CAN-LOCK-EDIT-01 — irreversível e não editável (CF-09)
- quando: A abre `GET /organizer/events/<E3>`; envia `POST /organizer/events/<E3>` (edição com dados válidos), `POST .../publish` e `POST .../cancel`
- então: a página não tem formulário de edição, nem "Publicar", nem "Cancelar evento"; os três POSTs respondem 409 e E3 continua `cancelled` com os mesmos dados.

### CAN-ACL-01 — só o dono cancela (CF-09)
- quando: B envia `POST /organizer/events/<E de A publicado>/cancel`; participante faz o mesmo
- então: B → 404 sem dados; participante → 403; o evento continua publicado e na vitrine.
