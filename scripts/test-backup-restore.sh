#!/usr/bin/env bash
# Critério 14 — teste automatizado de backup e restauração (sem Docker).
# Requer PostgreSQL local e um usuário com CREATEDB. Ex.:
#   PGHOST=localhost PGUSER=mapscontrol PGPASSWORD=... scripts/test-backup-restore.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
SRC="mc_bk_src_$$"; DST="mc_bk_dst_$$"
cleanup() { dropdb --if-exists "$SRC"; dropdb --if-exists "$DST"; rm -rf "$WORK"; }
trap cleanup EXIT
createdb "$SRC"
export DATABASE_URL="postgres://${PGUSER}:${PGPASSWORD}@${PGHOST:-localhost}:${PGPORT:-5432}/$SRC"
export NODE_ENV=development CODE_PEPPER="teste-backup-pepper-0123456789abcdefghij" MAIL_TRANSPORT=memory DEMO_PASSWORD="demo-senha-1234"
(cd "$ROOT/server" && node dist/cli/seed-demo.js >/dev/null)
before=$(psql -X -At -d "$SRC" -c "SELECT (SELECT count(*) FROM visit_records)||'/'||(SELECT count(*) FROM units)||'/'||(SELECT count(*) FROM users)")
PGDATABASE="$SRC" BACKUP_DIR="$WORK" sh "$ROOT/deploy/scripts/backup-loop.sh" --once >/dev/null
DUMP=$(ls -1 "$WORK"/mapscontrol-*.dump | head -1)
(cd "$WORK" && sha256sum -c "$(basename "$DUMP").sha256" >/dev/null)
dropdb "$SRC"                      # simula perda total do banco
createdb "$DST"
pg_restore --no-owner --no-privileges -d "$DST" "$DUMP"
after=$(psql -X -At -d "$DST" -c "SELECT (SELECT count(*) FROM visit_records)||'/'||(SELECT count(*) FROM units)||'/'||(SELECT count(*) FROM users)")
status=$(psql -X -At -d "$DST" -c "SELECT count(*) FROM target_status WHERE status='letter'")
echo "antes: $before  depois: $after  (registros/apartamentos/usuários); alvos com carta: $status"
[ "$before" = "$after" ] && [ "$status" -gt 0 ] && echo "OK: backup restaurado com os mesmos dados." || { echo "FALHOU" >&2; exit 1; }
