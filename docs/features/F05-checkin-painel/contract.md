# Contrato F05 — Check-in e painel

## Pré-requisitos

- Ambiente de pé (`./scripts/up.sh`, modo padrão); `$WEB`/`$API` = `http://localhost:${PORT:-3000}`.
- A e B logados; participante criado via signup. Ingressos criados pela vitrine (F03) e, para o canal `partner`, pelo serviço `purchaseTicket` de F03 com `channel='partner'` (via `docker compose exec app node -e ...`) ou pela API de F04 se já integrada.
- Estados que dependem de F06 (evento cancelado, ingresso estornado) podem ser montados com SQL direto: `docker compose exec db psql -U catraca catraca -c "..."`.

## Quality gates

- `./scripts/gates.sh` — exit 0, inclui testes de check-in e painel.

## Mapeamento critério → itens

| Critério PRD | Itens |
|---|---|
| F05-AC01 | CHK-OK-01, CHK-USED-01, CHK-NOTCONF-01, CHK-INVALID-01, CHK-OTHER-EVENT-01, CHK-CANCELLED-01 |
| F05-AC02 | PANEL-01 |
| F05-AC03 | PANEL-REVENUE-01 |
| F05-AC04 | CHK-CONC-01 |
| CF-07 (F02→F05) | PANEL-01, ACL-PANEL-01 |
| CF-08 (F03→F05) | CHK-OK-01, CHK-NOTCONF-01, PANEL-01, PANEL-REVENUE-01 |

## Itens

Cenário base: A cria e publica E (lotação 3, R$ 100,00). Participante compra na vitrine com `...0001` (código C1, confirmado em ≤ 5 s). Uma compra canal `partner` com `...0004` (código C2, fica pendente ~30–40 s).

### CHK-OK-01 — Entrada liberada
- quando: A envia `POST /organizer/events/<E>/checkin` com `code=C1` (também testar `c1` minúsculo com espaços em outro ingresso confirmado)
- então: 200 com `data-checkin-result="ok"` e texto exatamente "Entrada liberada".

### CHK-USED-01 — Ingresso já utilizado
- quando: C1 de novo
- então: "Ingresso já utilizado".

### CHK-NOTCONF-01 — Ingresso não confirmado
- quando: C2 (pendente, canal partner); depois de C2 ficar recusado, C2 de novo
- então: as duas vezes "Ingresso não confirmado".

### CHK-INVALID-01 — código inexistente
- quando: `code=ZZZZZZZZ`
- então: "Ingresso inválido para este evento".

### CHK-OTHER-EVENT-01 — código de evento de outro organizador
- quando: B cria/publica E2, compra-se E2 (código C3); A faz check-in de C3 em E
- então: "Ingresso inválido para este evento".

### CHK-CANCELLED-01 — evento cancelado tem precedência
- quando: evento F publicado de A com um ingresso confirmado já com check-in (C4) e um confirmado sem check-in (C5); `UPDATE events SET status='cancelled' WHERE id=<F>`; check-in de C4, C5 e de um código inexistente
- então: C4 → "Evento cancelado"; C5 → "Evento cancelado"; inexistente → "Ingresso inválido para este evento".

### CHK-CONC-01 — check-in concorrente
- quando: 10 POSTs simultâneos de check-in com o mesmo código confirmado ainda não usado
- então: exatamente 1 resposta com "Entrada liberada" e 9 com "Ingresso já utilizado".

### PANEL-01 — números do painel (CF-07, CF-08)
- quando: no cenário base após CHK-OK-01 e C2 ainda pendente, `GET /organizer/events/<E>`
- então: `confirmed=1`, `pending=1`, `checkins=1`, `available=1`, `revenue=R$ 100,00`, `refunded=0` nos elementos `data-metric`; após C2 recusado: `pending=0`, `available=2`.

### PANEL-REVENUE-01 — receita com preço do momento e estornados fora
- quando: em evento G (R$ 100,00, lotação 5), 2 compras confirmadas; A muda preço para R$ 150,00 (gestão F02); 1 compra confirmada; `UPDATE tickets SET status='refunded'` em uma terceira compra confirmada extra
- então: painel mostra `confirmed=3`, `revenue=R$ 350,00`, `refunded=1`.

### ACL-PANEL-01 — isolamento (CF-07)
- quando: B abre `GET /organizer/events/<E>` e envia `POST /organizer/events/<E>/checkin` com um código válido de E ainda não usado
- então: 404 sem nome nem números de E; o ingresso continua sem check-in (A depois recebe "Entrada liberada" com ele).
