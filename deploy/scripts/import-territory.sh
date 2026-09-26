#!/usr/bin/env bash
# Importa território de um JSON PRIVADO (ex.: deploy/private/territorio.json — pasta ignorada pelo git).
# Uso: scripts/import-territory.sh <uuid-da-congregacao> private/territorio.json
set -euo pipefail
cd "$(dirname "$0")/.."
CID="${1:?uuid da congregação}"; FILE="${2:?arquivo json}"
docker compose --env-file .env exec -T app sh -c 'cat > /tmp/territorio.json' < "$FILE"
docker compose --env-file .env exec -T app node dist/cli/import-territory.js --congregation "$CID" --file /tmp/territorio.json
docker compose --env-file .env exec -T app rm -f /tmp/territorio.json
