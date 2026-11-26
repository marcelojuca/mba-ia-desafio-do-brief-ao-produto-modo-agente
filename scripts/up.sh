#!/usr/bin/env bash
# Sobe o produto (db + app). O app migra, roda a seed e só então fica healthy.
# Variáveis: PORT (padrão 3000), COMPOSE_PROJECT_NAME (padrão catraca).
set -euo pipefail
cd "$(dirname "$0")/.."

if ! docker info >/dev/null 2>&1; then
  echo "Docker não está em execução. Inicie o Docker e tente de novo." >&2
  exit 1
fi

PORT="${PORT:-3000}"
export PORT

if ! docker compose up -d --build --wait --wait-timeout 180; then
  echo "Falha ao subir o ambiente. Logs do app:" >&2
  docker compose logs --tail 80 app >&2 || true
  exit 1
fi

WEB="http://localhost:${PORT}"
echo ""
echo "Catraca no ar (projeto: ${COMPOSE_PROJECT_NAME:-catraca})"
echo "WEB=${WEB}"
echo "API=${WEB}"
echo "Derrubar: ./scripts/down.sh"
