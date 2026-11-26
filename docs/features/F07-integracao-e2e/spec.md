# Spec F07 — Integração ponta a ponta

PRD: `docs/PRD.md` § F07. Critérios: F07-AC01, F07-AC02, CF-11, CF-12, CF-13. Regras exercitadas: R01–R13.
Base: main integrada depois da wave 4 (F01–F06).

## Objetivo

Transformar o Fluxo do avaliador (passos 2–16 do desafio) num script executável que prova que as features funcionam
**juntas**, no modo padrão do gateway (atrasos reais), contra o ambiente subido por `./scripts/up.sh`. É a cobrança
final: relatório verde é promessa, o fluxo é a prova.

## `scripts/e2e-flow.mjs` (`npm run e2e`)

- Node puro (`fetch` nativo), sem dependências. Variáveis: `WEB` (padrão `http://localhost:3000`), `API` (padrão = `WEB`), `KEY` (padrão `catraca-parceiro-dev`).
- Cliente com cookie jar por "ator" (A, B, participante da seed, participante novo, visitante) e `redirect: 'manual'`.
- Extrai dados do HTML pelos ganchos `data-*` definidos nas specs de F02, F03 e F05 (`data-event-id`, `data-ticket-code`, `data-ticket-status`, `data-metric`, `data-checkin-result`, `data-event-status`) e pelo `Location` dos redirects (id do evento criado).
- Cada verificação imprime `✔ passo N — descrição` ou `✘ passo N — esperado X, obtido Y` e o script sai com código ≠ 0 na primeira falha.
- Datas: E1..E5 no mês seguinte; "ontem" para o passo 3.
- Ordem dos passos idêntica ao Fluxo do avaliador:
  2. A cria E1 (lotação 2, R$ 100,00) sem publicar → ausente da vitrine (visitante) e da API.
  3. A tenta criar evento com data de ontem → 422.
  4. A publica E1 → vitrine e API com `availableSeats 2`, `priceCents 10000`.
  5. Participante novo (signup) compra E1 na vitrine com `...0001` → `pending` em "Meus ingressos" e `confirmed` em ≤ 5 s (C1).
  6. API compra E1 com `...0004` → 202 `pending` (T2/C2); `availableSeats 0`.
  7. Antes de 30 s: API compra com `...0001` → 409 `sold_out`; vitrine do participante mostra "Ingressos esgotados".
  8. Após 45 s do passo 6: T2 `declined`, `availableSeats 1`; T3 (`...0001`) `confirmed` em ≤ 5 s.
  9. A reduz lotação para 1 → rejeitado; preço R$ 150,00 e lotação 3 → aceito; T4 confirmado; painel: 3/0/0/0/R$ 350,00/0.
  10. Check-in: C1 → Entrada liberada; C1 → Ingresso já utilizado; C2 → Ingresso não confirmado; ZZZZZZZZ → Ingresso inválido para este evento; painel Check-ins 1.
  11. B: lista sem E1; URL de E1 sem dados; cria/publica E2 (lotação 1, R$ 20,00), compra pela API (C3). Participante da seed e visitante: URL de E1 sem dados. A: C3 em E1 → Ingresso inválido para este evento.
  12. A cria/publica E3 (lotação 5, R$ 50,00); API compra T5 (`...0003`) e T6 (`...0001`, C6); espera T6 `confirmed`; cancela E3 antes de 30 s de T5.
  13. E3 fora da vitrine e da API; compra → 404 `event_not_available`; em ≤ 10 s T6 `refunded` e T5 `cancelled`; gestão de E3 sem formulário de edição e edição → 409.
  14. Após 45 s de T5: T5 `cancelled`; C6 → Evento cancelado; painel E3: 0/0/0/0/R$ 0,00/1.
  15. E4 e E5 (lotação 5, R$ 10,00): 30 compras simultâneas (`Promise.all`) → exatamente 5×202 e 25×409; em ≤ 10 s painel Confirmados 5 e Vagas 0.
  16. 401 nas três rotas sem chave e com chave errada; `cardNumber "123"` → 422; ticket inexistente → 404 `ticket_not_found`.
- Duração esperada: ~2 min (dominada pelas esperas de 45 s dos passos 8 e 14).

## README final (F07-AC02)

Seções: Como rodar (pré-requisitos, `up`/`down`/`gates`/`e2e`), Endereços (`$WEB`, `$API`), Credenciais (A, B, participante, chave), Mapa dos artefatos (PRD, pasta de cada feature, `docs/state.json`, `AGENTS.md`, links dos PRs da wave 4), Decisões (stack e por quê; R07 com `SELECT ... FOR UPDATE`; gateway assíncrono persistido + worker com guarda `status='pending'`; avaliação isolada por subagente de contexto vazio, relatórios imutáveis), Como as features foram entregues (waves e PRs).
