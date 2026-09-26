#!/usr/bin/env bash
# Restaura um backup no banco de PRODUÇÃO (substitui os dados atuais).
# 1) faz um backup de segurança do estado atual; 2) para a aplicação;
# 3) recria o banco a partir do dump; 4) sobe a aplicação e checa a saúde.
set -euo pipefail
cd "$(dirname "$0")/.."
DUMP="${1:?uso: scripts/restore.sh backups/mapscontrol-AAAAMMDD-HHMMSS.dump}"
[ -f "$DUMP" ] || { echo "Arquivo não encontrado: $DUMP" >&2; exit 1; }
if [ -f "$DUMP.sha256" ]; then (cd "$(dirname "$DUMP")" && sha256sum -c "$(basename "$DUMP").sha256"); fi
read -r -p "Isto SUBSTITUI os dados atuais por $DUMP. Digite RESTAURAR para continuar: " ok
[ "$ok" = "RESTAURAR" ] || { echo "Cancelado."; exit 1; }
APP_PORT=$(grep -E '^APP_PORT=' .env | cut -d= -f2 || true)
DC="docker compose --env-file .env"
echo "Backup de segurança do estado atual…"
scripts/backup-now.sh
$DC stop app
$DC exec -T db psql -U mapscontrol -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS mapscontrol_old" -c "ALTER DATABASE mapscontrol RENAME TO mapscontrol_old" -c "CREATE DATABASE mapscontrol OWNER mapscontrol"
if ! $DC exec -T db pg_restore --no-owner --no-privileges -U mapscontrol -d mapscontrol < "$DUMP"; then
  echo "Falha ao restaurar; voltando ao banco anterior." >&2
  $DC exec -T db psql -U mapscontrol -d postgres -c "DROP DATABASE mapscontrol" -c "ALTER DATABASE mapscontrol_old RENAME TO mapscontrol"
  $DC start app
  exit 1
fi
$DC start app
sleep 5
curl -fsS "http://127.0.0.1:${APP_PORT:-8087}/api/health" && echo " — aplicação no ar."
echo "Banco anterior mantido como 'mapscontrol_old'. Após conferir, remova com:"
echo "  $DC exec db psql -U mapscontrol -d postgres -c 'DROP DATABASE mapscontrol_old'"
