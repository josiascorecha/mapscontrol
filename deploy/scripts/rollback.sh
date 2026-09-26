#!/usr/bin/env bash
# Volta a aplicação para a imagem anterior (mapscontrol-app:previous).
# Se a versão nova aplicou migração de banco incompatível, restaure também o backup
# feito antes do deploy:  scripts/restore.sh "$(cat backups/.pre-deploy)"
set -euo pipefail
cd "$(dirname "$0")/.."
docker image inspect mapscontrol-app:previous >/dev/null 2>&1 || { echo "Não há imagem anterior." >&2; exit 1; }
docker tag mapscontrol-app:previous mapscontrol-app:latest
docker compose --env-file .env up -d --no-build app
echo "Rollback aplicado. Backup pré-deploy: $(cat backups/.pre-deploy 2>/dev/null || echo 'nenhum')"
