#!/usr/bin/env bash
# Implanta/atualiza o MapsControl na VPS com rollback automático se a saúde falhar.
# Executar na pasta deploy/ do repositório clonado na VPS.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Crie deploy/.env a partir de .env.example" >&2; exit 1; }
if grep -qE '=(troque|usuario$|senha$)' .env; then echo "Há valores de exemplo no .env. Revise antes de implantar." >&2; exit 1; fi
APP_PORT=$(grep -E '^APP_PORT=' .env | cut -d= -f2); APP_PORT=${APP_PORT:-8087}
DC="docker compose --env-file .env"
mkdir -p backups

echo "1/5 Guardando a imagem atual para rollback…"
if docker image inspect mapscontrol-app:latest >/dev/null 2>&1; then
  docker tag mapscontrol-app:latest mapscontrol-app:previous
  HAS_PREVIOUS=1
else
  HAS_PREVIOUS=0
fi

echo "2/5 Backup antes da atualização…"
if [ "$($DC ps -q db 2>/dev/null)" ]; then
  $DC up -d backup >/dev/null
  scripts/backup-now.sh | tail -1 > backups/.pre-deploy
  echo "   backup: $(cat backups/.pre-deploy)"
else
  echo "   primeiro deploy: nenhum banco para copiar"
fi

echo "3/5 Construindo a imagem…"
$DC build app

echo "4/5 Subindo serviços…"
$DC up -d

echo "5/5 Verificando saúde em 127.0.0.1:${APP_PORT}…"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null 2>&1; then
    echo "OK: MapsControl no ar."
    $DC ps
    exit 0
  fi
  sleep 2
done

echo "FALHA na verificação de saúde. Últimos logs:" >&2
$DC logs --tail 50 app >&2 || true
if [ "$HAS_PREVIOUS" = 1 ]; then
  echo "Revertendo para a imagem anterior…" >&2
  scripts/rollback.sh
fi
exit 1
