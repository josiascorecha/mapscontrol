#!/usr/bin/env bash
# Configura o Administrador Geral (roda dentro do container da aplicação).
# Uso: scripts/bootstrap-global-admin.sh "email@dominio" "Nome Completo"
# Um link de ativação é enviado por e-mail; nenhuma senha é criada ou exibida.
set -euo pipefail
cd "$(dirname "$0")/.."
EMAIL="${1:?informe o e-mail}"; NAME="${2:?informe o nome}"
docker compose --env-file .env exec -T -e GLOBAL_ADMIN_EMAIL="$EMAIL" -e GLOBAL_ADMIN_NAME="$NAME" app node dist/cli/bootstrap-global-admin.js
