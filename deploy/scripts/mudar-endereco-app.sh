#!/usr/bin/env bash
# Troca o endereço principal do MapsControl mantendo o antigo funcionando, com aviso.
#
#   bash scripts/mudar-endereco-app.sh https://mapscontrol.novo.com.br 2026-10-23
#
# - APP_ORIGIN passa a ser o endereço novo (links dos e-mails levam para lá);
# - o endereço atual vai para EXTRA_ORIGINS (continua aceito até o redirecionamento);
# - ADDRESS_CHANGE_DATE liga o aviso para quem entra pelo endereço antigo;
# - faz cópia do .env e implanta com scripts/deploy.sh (que tem rollback automático).
# Antes de trocar, confere se o endereço novo já responde com HTTPS válido.
# Para encerrar o aviso depois da mudança: deixe ADDRESS_CHANGE_DATE vazio e implante de novo.
set -euo pipefail
cd "$(dirname "$0")/.."
NEW="${1:-}"; DATE="${2:-}"
[[ "$NEW" =~ ^https://[A-Za-z0-9.-]+$ ]] || { echo "Uso: $0 https://novo.endereco AAAA-MM-DD" >&2; exit 2; }
[[ "$DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "Data no formato AAAA-MM-DD." >&2; exit 2; }
[[ -f .env ]] || { echo "deploy/.env não encontrado." >&2; exit 1; }

CUR=$(grep -E '^APP_ORIGIN=' .env | cut -d= -f2- | sed 's:/*$::')
[[ "$CUR" != "$NEW" ]] || { echo "APP_ORIGIN já é $NEW. Nada a fazer."; exit 0; }

echo "Conferindo $NEW/api/health…"
if ! curl -fsS -m 15 "$NEW/api/health" >/dev/null; then
  echo "O endereço novo ainda não responde com HTTPS válido. Rode antes: mudar-dominio.sh adicionar (DNS + Nginx + certificado)." >&2
  exit 1
fi

cp -p .env ".env.antes-mudanca-$(date +%Y%m%d-%H%M%S)"
chmod 600 .env.antes-mudanca-*
EXTRA=$(grep -E '^EXTRA_ORIGINS=' .env | cut -d= -f2- || true)
case ",$EXTRA," in *",$CUR,"*) ;; *) EXTRA="${EXTRA:+$EXTRA,}$CUR" ;; esac

set_var() { # $1=nome $2=valor (substitui ou acrescenta)
  if grep -qE "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}
set_var APP_ORIGIN "$NEW"
set_var EXTRA_ORIGINS "$EXTRA"
set_var ADDRESS_CHANGE_DATE "$DATE"
echo "APP_ORIGIN=$NEW  EXTRA_ORIGINS=$EXTRA  ADDRESS_CHANGE_DATE=$DATE"

bash scripts/deploy.sh
echo "Conferindo o aviso:"
curl -fsS -m 15 "$CUR/api/config" | grep -o '"appOrigin":"[^"]*","addressChangeDate":"[^"]*"' || echo "  (não consegui ler $CUR/api/config)"
