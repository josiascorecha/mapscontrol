#!/bin/sh
# Roda dentro do container "backup": um dump por dia no horário BACKUP_HOUR,
# formato custom do pg_dump (-Fc), com retenção de BACKUP_KEEP_DAYS dias.
set -eu
: "${BACKUP_DIR:=/backups}" "${BACKUP_KEEP_DAYS:=30}" "${BACKUP_HOUR:=3}"
mkdir -p "$BACKUP_DIR"

run_backup() {
  ts=$(date +%Y%m%d-%H%M%S)
  tmp="$BACKUP_DIR/.mapscontrol-$ts.dump.part"
  out="$BACKUP_DIR/mapscontrol-$ts.dump"
  if pg_dump -Fc --no-owner --no-privileges -f "$tmp"; then
    mv "$tmp" "$out"
    sha256sum "$out" > "$out.sha256"
    echo "$(date -Iseconds) backup ok: $(basename "$out") ($(du -h "$out" | cut -f1))"
  else
    rm -f "$tmp"
    echo "$(date -Iseconds) ERRO no backup" >&2
  fi
  find "$BACKUP_DIR" -name 'mapscontrol-*.dump*' -type f -mtime +"$BACKUP_KEEP_DAYS" -delete
}

if [ "${1:-}" = "--once" ]; then run_backup; exit 0; fi

echo "Agendador de backup iniciado (diário às ${BACKUP_HOUR}h, retenção ${BACKUP_KEEP_DAYS} dias)"
last=""
while true; do
  today=$(date +%Y-%m-%d)
  hour=$(date +%H | sed 's/^0//')
  if [ "$hour" = "$BACKUP_HOUR" ] && [ "$last" != "$today" ]; then
    run_backup
    last="$today"
  fi
  sleep 300
done
