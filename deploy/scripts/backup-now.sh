#!/usr/bin/env bash
# Faz um backup imediato (ex.: antes de um deploy). Executar na pasta deploy/.
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose --env-file .env exec -T backup /bin/sh /backup-loop.sh --once
ls -1t backups/mapscontrol-*.dump | head -1
