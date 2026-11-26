# Plano F07 — Integração ponta a ponta

1. `scripts/e2e-flow.mjs`: cliente HTTP com cookie jar, helpers de extração `data-*`, asserções com saída por passo; script `e2e` no `package.json`.
2. Implementar os passos 2–16 na ordem do Fluxo do avaliador.
3. Rodar contra `./scripts/up.sh` da main integrada; corrigir na própria F07 qualquer bug de integração encontrado entre features (com teste de regressão no gates), registrando no PR.
4. README final com todas as seções do entregável e AGENTS.md atualizado com `npm run e2e`.
5. `./scripts/gates.sh` e `npm run e2e` verdes; commits `feat(F07): ...`.
