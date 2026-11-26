# Plano F03 — Compra de ingressos e gateway simulado

1. Migração `0003_tickets_payments.sql`; `src/tickets/status.js`, `code.js`, `repo.js`.
2. Gateway simulado `src/gateway/simulated.js` + testes de tabela (finais, faixas de atraso, escala).
3. `availability.js` e `purchase.js` (lock `FOR UPDATE`, ordem de erros) + testes, incluindo o teste de concorrência 30×5 repetido 5 vezes.
4. Worker `src/gateway/worker.js` registrado como background job; testes: aprova, recusa e libera vaga, guarda `status='pending'`.
5. Validador de lotação (R03) registrado no gancho de F02 + teste via página de gestão.
6. Vitrine com vagas, formulário e "Ingressos esgotados"; `POST /events/:id/purchase`; `/my-tickets`; link no layout.
7. Testes HTTP: compra pendente → confirmada (escala pequena), recusa libera vaga, esgotado na vitrine e na tentativa, cartão inválido, visitante não compra, preço vigente por compra, "Meus ingressos" isolado por usuário.
8. `./scripts/gates.sh` verde; commits `feat(F03): ...`.
