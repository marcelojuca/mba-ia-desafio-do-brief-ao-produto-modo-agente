# Contrato F07 — Integração ponta a ponta

## Pré-requisitos

- Clone limpo da main integrada (ou do commit avaliado), Docker em execução, Node.js LTS.
- `./scripts/up.sh` no modo padrão do gateway (atrasos reais). `$WEB=$API=http://localhost:${PORT:-3000}`, `$KEY=catraca-parceiro-dev`.

## Quality gates

- `./scripts/gates.sh` — exit 0.

## Mapeamento critério → itens

| Critério PRD | Itens |
|---|---|
| F07-AC01 | E2E-RUN-01, E2E-RUN-02 |
| F07-AC02 | README-01 |
| CF-11 (F04→F07) | E2E-RUN-01 (passos 6–9, 11–15), E2E-MANUAL-API-01 |
| CF-12 (F05→F07) | E2E-RUN-01 (passos 9–11) |
| CF-13 (F06→F07) | E2E-RUN-01 (passos 12–14) |

## Itens

### E2E-RUN-01 — fluxo completo
- quando: `npm run e2e` com o ambiente recém-subido
- então: exit 0; a saída tem um `✔` para cada passo de 2 a 16, nenhum `✘`.

### E2E-RUN-02 — repetível
- quando: `npm run e2e` de novo sem derrubar (eventos novos são criados a cada execução), depois `./scripts/down.sh && ./scripts/up.sh` e `npm run e2e` mais uma vez
- então: as duas execuções terminam com exit 0.

### E2E-MANUAL-API-01 — conferência manual cruzada (CF-11)
- quando: com o ambiente de pé, o avaliador executa à mão: A cria/publica um evento (lotação 2); compra pela API com `...0001`; compra na vitrine com `...0001` como participante; `GET /api/partner/events`; painel; check-in do código da API; cancela o evento; consulta os dois ingressos pela API
- então: `availableSeats 0` após as duas compras; painel Confirmados 2 e Check-ins 1 após o check-in; após cancelar, os dois `refunded`, painel Estornados 2 e Receita R$ 0,00.

### README-01 — README completo
- então: o README tem as seções Como rodar, Endereços, Credenciais, Mapa dos artefatos (com links dos PRs da wave 4 no GitHub) e Decisões (stack, R07, gateway assíncrono, isolamento da avaliação), e os caminhos citados existem.
