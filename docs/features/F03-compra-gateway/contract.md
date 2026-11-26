# Contrato F03 — Compra de ingressos e gateway simulado

## Pré-requisitos

- Ambiente de pé com `./scripts/up.sh` no **modo padrão** (sem `GATEWAY_DELAY_SCALE`); `$WEB = http://localhost:${PORT:-3000}`.
- Organizador A logado (cookie) para criar/publicar eventos pela área de F02; participantes criados via `POST /signup` (F01).
- Datas: mês seguinte.

## Quality gates

- `./scripts/gates.sh` — exit 0; inclui o teste de concorrência (30 compras, lotação 5, 5 rodadas) e os testes do gateway.

## Mapeamento critério → itens

| Critério PRD | Itens |
|---|---|
| F03-AC01 | BUY-WEB-01 |
| F03-AC02 | BUY-WEB-01, MY-TICKETS-01 |
| F03-AC03 | SEAT-PENDING-01 |
| F03-AC04 | SOLDOUT-WEB-01 |
| F03-AC05 | CONC-01 |
| F03-AC06 | GW-SLOW-01, CARD-INVALID-01, GW-NOKEY-01 |
| F03-AC07 | SEAT-PENDING-01, AVAIL-CANCELLED-01 |
| F03-AC08 | CAP-EDIT-01, PRICE-SNAPSHOT-01 |
| CF-02 (F01→F03) | MY-TICKETS-01, VISITOR-01 |
| CF-03 (F02→F03) | PUB-BUY-01, PRICE-SNAPSHOT-01 |
| CF-04 (F02→F03) | CAP-EDIT-01 |

## Itens

### PUB-BUY-01 — evento publicado por F02 é comprável; rascunho não
- quando: A cria E (lotação 2, R$ 100,00) sem publicar; participante `GET /` e `POST /events/<E>/purchase` com cartão `4000000000000001`; A publica E; participante `GET /`
- então: antes de publicar, a vitrine não mostra E e o POST responde 404 "Evento indisponível" sem criar ingresso; depois de publicar, a vitrine mostra E com "Vagas disponíveis: 2" e o formulário de compra.

### BUY-WEB-01 — compra pendente que confirma em até 5 s
- quando: participante novo (signup) compra E com `4000000000000001`; imediatamente `GET /my-tickets`; após 5 s `GET /my-tickets`
- então: o POST responde 303 em menos de 1 s; a primeira leitura mostra o evento, status "pendente" e um código de 8 caracteres; a segunda mostra "confirmado" com o mesmo código.

### MY-TICKETS-01 — "Meus ingressos" isolado por participante
- quando: dois participantes (signup) compram cada um um ingresso; cada um abre `/my-tickets`
- então: cada um vê só o próprio ingresso (evento, status, código); os códigos são diferentes.

### VISITOR-01 — visitante não compra
- quando: deslogado `GET /` e `POST /events/<E>/purchase`
- então: a vitrine mostra "Entre como participante para comprar" e nenhum formulário de cartão; o POST redireciona para `/login` e nenhum ingresso é criado.

### SEAT-PENDING-01 — pendente ocupa vaga; recusa libera
- quando: evento com lotação 1 publicado; participante compra com `4000000000000002`; imediatamente `GET /`; aguarda 6 s; `GET /`
- então: logo após a compra a vitrine mostra "Ingressos esgotados" para o evento; após 6 s o ingresso está "recusado" em `/my-tickets` e a vitrine volta a mostrar o formulário com "Vagas disponíveis: 1".

### SOLDOUT-WEB-01 — esgotado na vitrine e como resposta
- quando: evento com lotação 1 com ingresso pendente/confirmado; participante B (com a página aberta antes) envia `POST /events/<E>/purchase`
- então: 409 e a página exibe "Ingressos esgotados"; `GET /` mostra "Ingressos esgotados" no lugar do formulário.

### CONC-01 — 30 compras simultâneas, lotação 5
- quando: evento novo com lotação 5 publicado; 30 `POST /events/<E>/purchase` simultâneos (`xargs -P 30`) com o cookie de um participante e cartão `4000000000000001`, contando status HTTP; repetir com outro evento novo
- então: em cada rodada exatamente 5 respostas 303 e 25 respostas 409; `SELECT count(*) FROM tickets WHERE event_id=<E> AND status IN ('pending','confirmed')` = 5.

### GW-SLOW-01 — cartões lentos e recusa padrão
- quando: compras em eventos com vaga usando `...0003`, `...0004` e `...9999`; ler `/my-tickets` (ou o banco) aos 6 s, aos 25 s e aos 42 s
- então: `0003` pendente aos 25 s e confirmado aos 42 s; `0004` pendente aos 25 s e recusado aos 42 s; `9999` recusado aos 6 s.

### CARD-INVALID-01 — cartão sem 16 dígitos
- quando: `POST /events/<E>/purchase` com `cardNumber=123` e com `cardNumber=40000000000000012`
- então: 422 "O número do cartão deve ter 16 dígitos"; nenhum ingresso novo no banco.

### GW-NOKEY-01 — sem chave de pagamento
- então: `docker compose config` e `.env*` do repositório não contêm chave de gateway; BUY-WEB-01 passou sem nenhuma configuração extra.

### CAP-EDIT-01 — lotação vs. vagas ocupadas pela página de gestão de F02
- quando: evento com lotação 2 e 2 ingressos ocupando vaga; A envia edição com `capacity=1`; depois com `capacity=3`
- então: `capacity=1` → 422 com "A lotação não pode ser menor que as vagas ocupadas (2)" e lotação continua 2; `capacity=3` → aceito, vitrine mostra "Vagas disponíveis: 1".

### PRICE-SNAPSHOT-01 — preço vigente por compra
- quando: evento a R$ 100,00 com um ingresso comprado; A muda o preço para R$ 150,00 na gestão; nova compra
- então: no banco, o primeiro ingresso tem `price_cents = 10000` e o segundo `15000`.

### AVAIL-CANCELLED-01 — evento cancelado tem zero vagas
- quando: teste automatizado de `getAvailability` com evento `status='cancelled'` (gates)
- então: `available = 0` (teste nomeado `availability cancelled` passa).
