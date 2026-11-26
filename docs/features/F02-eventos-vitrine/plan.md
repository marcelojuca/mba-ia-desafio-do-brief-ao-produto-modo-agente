# Plano F02 — Eventos do organizador e vitrine

1. Migração `0002_events.sql` e `src/events/repo.js`.
2. `validation.js` (R01, preço em reais → centavos, data em −03:00) com testes unitários.
3. `service.js`, `edit-validators.js`, `management-sections.js`, `guard.js`.
4. Rotas do organizador (lista, criar, gestão, editar, publicar) registradas em `src/app.js`.
5. Vitrine `/` em `showcase.js` substituindo o placeholder de F01.
6. Testes HTTP (`test/events.test.js`): criação válida/inválida, data no passado na criação e na edição, rascunho fora da vitrine, publicação, isolamento entre organizadores (lista e URL direta → 404 sem dados), participante 403, visitante 302, edição de preço e aumento de lotação.
7. `./scripts/gates.sh` verde; commit por etapa `feat(F02): ...`.
