#!/usr/bin/env bash
# Quality gates: npm run check (sintaxe) + npm test (node:test) num projeto Compose isolado
# (catraca-gates, banco próprio, sem portas no host). Propaga o exit code e sempre derruba com down -v.
set -uo pipefail
cd "$(dirname "$0")/.."

compose=(docker compose -p catraca-gates -f docker-compose.gates.yml)

cleanup() {
  "${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM

cleanup # restos de uma execução interrompida

if ! "${compose[@]}" build tests; then
  echo "gates: falha no build da imagem" >&2
  exit 1
fi

"${compose[@]}" run --rm tests
status=$?

if [ "$status" -eq 0 ]; then
  echo "gates: OK"
else
  echo "gates: FALHOU (exit $status)" >&2
fi
exit "$status"
