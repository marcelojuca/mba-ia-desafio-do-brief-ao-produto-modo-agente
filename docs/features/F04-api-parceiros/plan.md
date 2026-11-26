# Plano F04 — API de parceiros

1. `src/partner/auth.js` (X-Api-Key, timing-safe) e `config.partnerApiKey`.
2. `src/partner/routes.js` com as três rotas e o tratamento de JSON inválido; montar em `src/app.js`.
3. `formatIsoBrt(date)` em `src/web/html.js` (ou `src/time.js`) para `startsAt`.
4. Testes `test/partner-api.test.js` (auth, formatos, ordem de erros, concorrência 30×5 em 2 rodadas, consulta multi-canal).
5. README: chave de parceiro e exemplos de curl.
6. `./scripts/gates.sh` verde; commits `feat(F04): ...`.
