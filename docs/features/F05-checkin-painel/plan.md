# Plano F05 — Check-in e painel

1. Migração `0005_checkin.sql`.
2. `src/checkin/service.js` (`checkIn`) com a ordem de R10 e locks; testes unitários com estados montados no banco.
3. Rota `POST /organizer/events/:id/checkin` + seção de check-in registradas (`src/app.js`, `registerManagementSection`).
4. `src/panel/service.js` (consulta agregada) + seção do painel.
5. Testes HTTP: mensagens exatas, isolamento por organizador, painel com canais web/partner, receita por preço pago, check-in concorrente.
6. `./scripts/gates.sh` verde; commits `feat(F05): ...`.
