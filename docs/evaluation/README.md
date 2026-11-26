# Avaliação independente

Quem implementa não avalia. Cada avaliação é feita por um **subagente novo, de contexto vazio** (Claude Code, ferramenta
`Agent`), que recebe apenas: o caminho da pasta da feature, o commit a avaliar e as instruções abaixo. Ele não vê a conversa
nem o raciocínio do implementador.

## Procedimento do avaliador

1. Fazer checkout do commit avaliado em uma pasta própria (worktree ou clone) e anotar `git rev-parse HEAD`.
2. Ler `AGENTS.md`, `docs/PRD.md` (seção da feature) e `contract.md` da feature. O contrato é a referência; a spec só tira dúvidas.
3. Subir o ambiente com `./scripts/up.sh` (porta via `PORT` e projeto via `COMPOSE_PROJECT_NAME` quando houver outro ambiente de pé), rodar os quality gates e exercitar **cada item** do contrato por comando (curl, psql, node) ou efeito observável.
4. Registrar o veredito de cada item: `PASS`, `FAIL` ou `BLOCKED`, sempre com evidência (comando + saída/resposta HTTP relevante).
5. Derrubar o ambiente (`./scripts/down.sh --clean`).
6. Gravar um arquivo **novo** `eval-report-<AAAA-MM-DDTHH-MM-SSZ>.md` na pasta da feature, seguindo `report-template.md`. Relatórios nunca são editados depois de commitados; uma reavaliação gera outro arquivo.

## Ciclo

`implementar → avaliar → (FAIL?) corrigir → avaliar de novo` até o relatório mais recente aprovar todos os itens.
O orquestrador atualiza `docs/state.json` (status e `latest_report`) depois de cada relatório.
