#!/usr/bin/env bash
# Derruba tudo que ./scripts/up.sh subiu. --clean também apaga o volume do banco.
# Use o mesmo COMPOSE_PROJECT_NAME da subida.
set -euo pipefail
cd "$(dirname "$0")/.."

args=(down --remove-orphans)
case "${1:-}" in
  "") ;;
  --clean) args+=(--volumes) ;;
  *) echo "uso: $0 [--clean]" >&2; exit 2 ;;
esac

docker compose "${args[@]}"
echo "Catraca derrubado (projeto: ${COMPOSE_PROJECT_NAME:-catraca})${1:+, volumes removidos}"
