# Plano F06 — Cancelamento de evento

1. Migração `0006_event_cancellation.sql`.
2. `src/cancellation/service.js` (`cancelEvent` com lock e UPDATE único com CASE) + testes unitários (transições, resposta tardia, corrida com o worker).
3. Rota `POST /organizer/events/:id/cancel` + seção na página de gestão (`src/app.js`, `registerManagementSection`).
4. Testes HTTP: vitrine sem o evento, compra recusada, edição/publicação bloqueadas, isolamento por organizador.
5. `./scripts/gates.sh` verde; commits `feat(F06): ...`.
