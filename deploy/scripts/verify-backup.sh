#!/usr/bin/env bash
# Verificação de restauração: restaura um dump em um banco TEMPORÁRIO e compara
# a contagem de linhas das tabelas principais com o banco de origem.
# Não toca no banco de produção (só lê).
#
# Na VPS (pasta deploy/):   scripts/verify-backup.sh [arquivo.dump]
# Local (sem Docker):       PGHOST=... PGUSER=... PGPASSWORD=... PGDATABASE=... LOCAL=1 scripts/verify-backup.sh arquivo.dump
set -euo pipefail
cd "$(dirname "$0")/.."
DUMP="${1:-$(ls -1t backups/mapscontrol-*.dump 2>/dev/null | head -1 || true)}"
[ -n "$DUMP" ] && [ -f "$DUMP" ] || { echo "Nenhum dump encontrado." >&2; exit 1; }
if [ -f "$DUMP.sha256" ]; then
  (cd "$(dirname "$DUMP")" && sha256sum -c "$(basename "$DUMP").sha256" >/dev/null) || { echo "Checksum inválido: $DUMP" >&2; exit 1; }
fi
TABLES="users congregations memberships territories blocks addresses units visit_records access_codes consents audit_log"
TMPDB="mapscontrol_verify_$(date +%s)"

if [ "${LOCAL:-0}" = "1" ]; then
  psql_src() { psql -X -At -v ON_ERROR_STOP=1 "$@"; }
  psql_tmp() { psql -X -At -v ON_ERROR_STOP=1 -d "$TMPDB" "$@"; }
  createdb "$TMPDB"
  trap 'dropdb --if-exists "$TMPDB"' EXIT
  pg_restore --no-owner --no-privileges -d "$TMPDB" "$DUMP"
else
  DC="docker compose --env-file .env"
  psql_src() { $DC exec -T db psql -X -At -v ON_ERROR_STOP=1 -U mapscontrol -d mapscontrol "$@"; }
  psql_tmp() { $DC exec -T db psql -X -At -v ON_ERROR_STOP=1 -U mapscontrol -d "$TMPDB" "$@"; }
  $DC exec -T db createdb -U mapscontrol "$TMPDB"
  trap '$DC exec -T db dropdb -U mapscontrol --if-exists "$TMPDB"' EXIT
  $DC exec -T db pg_restore --no-owner --no-privileges -U mapscontrol -d "$TMPDB" < "$DUMP"
fi

echo "Dump: $DUMP"
printf '%-16s %10s %10s\n' tabela backup atual
status=0
for t in $TABLES; do
  a=$(psql_tmp -c "SELECT count(*) FROM $t")
  b=$(psql_src -c "SELECT count(*) FROM $t")
  printf '%-16s %10s %10s\n' "$t" "$a" "$b"
  # O banco atual pode ter mais linhas (dados criados após o backup), nunca menos em tabelas só de inserção.
  [ "$a" -gt 0 ] || [ "$b" -eq 0 ] || status=2
done
m=$(psql_tmp -c "SELECT count(*) FROM schema_migrations")
echo "migrações no backup: $m"
if [ $status -eq 0 ]; then echo "RESTAURAÇÃO VERIFICADA: o dump restaura e contém dados."; else echo "ATENÇÃO: alguma tabela veio vazia no backup." >&2; fi
exit $status
