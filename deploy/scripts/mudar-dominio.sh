#!/usr/bin/env bash
# Mudança de domínio de todos os sites de uma VPS com Nginx + Certbot (e, opcional,
# do e-mail no docker-mailserver). Feito para mudar sem tirar nada do ar:
#
#   bash mudar-dominio.sh inspecionar  ANTIGO NOVO
#   bash mudar-dominio.sh adicionar    ANTIGO NOVO [--excluir h1,h2] [--simular]
#   bash mudar-dominio.sh email        ANTIGO NOVO [--simular]
#   bash mudar-dominio.sh redirecionar ANTIGO NOVO [--excluir h1,h2] [--simular]
#   bash mudar-dominio.sh desfazer     /root/backup-dominio-AAAAMMDD-HHMMSS.tgz
#
# inspecionar   só lê: sites, nomes, DNS dos nomes novos, certificados e e-mail.
# adicionar     cada site de ANTIGO passa a responder TAMBÉM pelo nome equivalente em NOVO
#               (www.antigo → www.novo). Os certificados são ampliados para os nomes novos.
#               Só entram nomes cujo DNS já aponta para esta VPS. Nada sai do ar.
# email         endereços @NOVO como apelidos das caixas @ANTIGO (mesma caixa, mesma senha)
#               e chave DKIM do NOVO. Reinicia o container de e-mail (≈30 s).
# redirecionar  os nomes antigos passam a responder 301 para os novos. A renovação dos
#               certificados continua funcionando (o desafio do Let's Encrypt tem prioridade).
# desfazer      volta /etc/nginx e /etc/letsencrypt ao backup indicado.
#
# --excluir     nomes antigos que ficam de fora (ex.: uma API que recebe POST de terceiros).
# --simular     mostra o que mudaria, sem mudar nada.
#
# Antes de mudar qualquer coisa é feito backup de /etc/nginx e /etc/letsencrypt em /root.
# Se o "nginx -t" falhar, o backup é restaurado na hora. Nenhuma senha é lida ou mostrada.
# O console web de alguns provedores cai em comandos longos: rode com
#   nohup bash mudar-dominio.sh adicionar ... > /root/mudar-dominio.log 2>&1 &
set -euo pipefail

CMD="${1:-}"
case "$CMD" in
  inspecionar|adicionar|email|redirecionar) ;;
  desfazer)
    BK="${2:-}"
    [[ -f "$BK" ]] || { echo "Uso: $0 desfazer /root/backup-dominio-....tgz" >&2; exit 2; }
    TS=$(date +%Y%m%d-%H%M%S)
    echo "== Desfazendo a partir de $BK"
    mv /etc/nginx "/etc/nginx.desfeito-$TS"
    mv /etc/letsencrypt "/etc/letsencrypt.desfeito-$TS"
    tar xzf "$BK" -C /
    nginx -t && systemctl reload nginx
    echo "Pronto. As versões substituídas ficaram em /etc/nginx.desfeito-$TS e /etc/letsencrypt.desfeito-$TS."
    echo "Se o e-mail usa cópia do certificado, rode o hook de cópia do certificado de novo."
    exit 0
    ;;
  *) sed -n '2,30p' "$0"; exit 2 ;;
esac

OLD="${2:-}"; NEW="${3:-}"
[[ -n "$OLD" && -n "$NEW" && "$OLD" != "$NEW" ]] || { echo "Informe ANTIGO e NOVO (ex.: antigo.com.br novo.com.br)." >&2; exit 2; }
shift 3
EXCLUDE=""; SIMULATE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --excluir) EXCLUDE="${2:-}"; shift 2 ;;
    --simular) SIMULATE=1; shift ;;
    *) echo "Opção desconhecida: $1" >&2; exit 2 ;;
  esac
done

[[ $EUID -eq 0 ]] || { echo "Rode como root." >&2; exit 1; }
for b in nginx python3; do command -v "$b" >/dev/null || { echo "Falta o comando $b." >&2; exit 1; }; done

MY_IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')
WORK=$(mktemp -d /tmp/mudar-dominio.XXXXXX)
trap 'rm -rf "$WORK"' EXIT

# ---------- Leitura da configuração do Nginx (python, só leitura) ----------
# Gera $WORK/hosts.tsv: nome_antigo<TAB>nome_novo<TAB>dns_ok(1/0)<TAB>já_adicionado(1/0)
python3 - "$OLD" "$NEW" "$EXCLUDE" "$MY_IP" > "$WORK/hosts.tsv" <<'PY'
import glob, os, re, socket, sys
old, new, excl, myip = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
excl = {e.strip() for e in excl.split(',') if e.strip()}
files = sorted({os.path.realpath(f) for f in glob.glob('/etc/nginx/sites-enabled/*') + glob.glob('/etc/nginx/conf.d/*.conf')})
names, lines = set(), []
for f in files:
    try: txt = open(f, encoding='utf-8', errors='replace').read()
    except OSError: continue
    for m in re.finditer(r'^\s*server_name\s+([^;]+);', txt, re.M):
        toks = m.group(1).split(); lines.append(toks); names.update(toks)
def map_new(h): return new if h == old else h[: -len(old)] + new
for h in sorted(n for n in names if (n == old or n.endswith('.' + old)) and n not in excl):
    n = map_new(h)
    try: ips = {ai[4][0] for ai in socket.getaddrinfo(n, 443, socket.AF_INET)}
    except OSError: ips = set()
    added = any(h in t and n in t for t in lines)
    print(f"{h}\t{n}\t{1 if myip in ips else 0}\t{1 if added else 0}")
PY

# Certificados: $WORK/certs.tsv: nome<TAB>tipo_de_chave<TAB>domínios (separados por espaço)
certs() {
  command -v certbot >/dev/null || { : > "$WORK/certs.tsv"; return; }
  certbot certificates 2>/dev/null | awk '
    /Certificate Name:/ {if(n!="") print n"\t"k"\t"d; n=$3; k=""; d=""}
    /Key Type:/ {k=tolower($3)}
    /Domains:/ {d=""; for(i=2;i<=NF;i++) d=d (d==""?"":" ") $i}
    END {if(n!="") print n"\t"k"\t"d}' > "$WORK/certs.tsv"
}
certs

backup() {
  BK="/root/backup-dominio-$(date +%Y%m%d-%H%M%S).tgz"
  tar czf "$BK" -C / etc/nginx etc/letsencrypt
  chmod 600 "$BK"
  echo "Backup: $BK   (para voltar: bash $0 desfazer $BK)"
}

nginx_test_or_restore() {
  if ! nginx -t 2>"$WORK/nginx-t.txt"; then
    cat "$WORK/nginx-t.txt" >&2
    echo "!! nginx -t falhou. Restaurando o backup $BK…" >&2
    mv /etc/nginx "/etc/nginx.com-erro-$(date +%s)"; tar xzf "$BK" -C / etc/nginx
    nginx -t && systemctl reload nginx
    exit 1
  fi
}

# Aplica (ou mostra, em --simular) uma edição python nos arquivos do Nginx.
# $1 = modo (add|redirect); hosts vêm de $WORK/selected.tsv (antigo<TAB>novo)
edit_nginx() {
  python3 - "$1" "$WORK/selected.tsv" "$SIMULATE" "$WORK" <<'PY'
import difflib, glob, os, re, sys
mode, sel, simulate, work = sys.argv[1], sys.argv[2], sys.argv[3] == '1', sys.argv[4]
pairs = [l.rstrip('\n').split('\t')[:2] for l in open(sel) if l.strip()]
m = dict(pairs)
files = sorted({os.path.realpath(f) for f in glob.glob('/etc/nginx/sites-enabled/*') + glob.glob('/etc/nginx/conf.d/*.conf')})
IF_RE = re.compile(r'(?m)^([ \t]*)if \(\$host = (\S+)\) \{[ \t]*\n[ \t]*return 301 https://\$host\$request_uri;[ \t]*\n[ \t]*\}[^\n]*\n')
changed = []
for f in files:
    if os.path.basename(f).startswith('redirecionar-'):
        continue
    src = open(f, encoding='utf-8').read()
    out = src
    def fix_names(mt):
        toks = mt.group(2).split()
        res = []
        for t in toks:
            if mode == 'add':
                res.append(t)
                if t in m and m[t] not in toks: res.append(m[t])
            else:  # redirect: tira o nome antigo, se o novo já está no mesmo bloco
                if t in m and m[t] in toks: continue
                res.append(t)
        if not res:  # nunca deixa um server_name vazio
            return mt.group(0)
        return f"{mt.group(1)}{' '.join(res)};"
    out = re.sub(r'(?m)^(\s*server_name\s+)([^;]+);', fix_names, out)
    def fix_if(mt):
        h = mt.group(2)
        if h not in m: return mt.group(0)
        if mode == 'add':
            if f"if ($host = {m[h]})" in out: return mt.group(0)
            return mt.group(0) + mt.group(0).replace(f"= {h})", f"= {m[h]})")
        return ''  # redirect: o bloco novo de redirecionamento cuida do nome antigo
    out = IF_RE.sub(fix_if, out)
    if mode == 'redirect':
        # Redirecionamentos internos (ex.: www → raiz) passam a apontar para o nome novo.
        out = re.sub(r'(return\s+30[1278]\s+https?://)([A-Za-z0-9.-]+)', lambda mt: mt.group(1) + m.get(mt.group(2), mt.group(2)), out)
    if out != src:
        changed.append(f)
        sys.stdout.writelines(difflib.unified_diff(src.splitlines(True), out.splitlines(True), f, f + ' (novo)'))
        if not simulate:
            open(f, 'w', encoding='utf-8').write(out)
open(os.path.join(work, 'changed.txt'), 'w').write('\n'.join(changed))
PY
}

run_hooks() { # $1 = nome do certificado
  local name="$1" doms
  doms=$(awk -F'\t' -v n="$name" '$1==n{print $3}' "$WORK/certs.tsv")
  export RENEWED_LINEAGE="/etc/letsencrypt/live/$name" RENEWED_DOMAINS="$doms"
  if [[ -d /etc/letsencrypt/renewal-hooks/deploy ]]; then run-parts --verbose /etc/letsencrypt/renewal-hooks/deploy || true; fi
  local hook; hook=$(awk -F' = ' '/^renew_hook/{print $2}' "/etc/letsencrypt/renewal/$name.conf" 2>/dev/null || true)
  if [[ -n "$hook" ]]; then echo "   hook do certificado: $hook"; bash -c "$hook" || true; fi
}

check() { # $1 = nome. Mostra: código HTTP, destino do redirecionamento e se o certificado é válido.
  local r
  r=$(curl -s -o /dev/null -m 10 --noproxy '*' -w "%{http_code} %{redirect_url}|%{ssl_verify_result}" --resolve "$1:443:127.0.0.1" "https://$1/" 2>/dev/null) || true
  local code_url="${r%|*}" verify="${r##*|}"
  if [[ "$code_url" == 000* ]]; then echo "SEM RESPOSTA ou certificado inválido (verificação=$verify)"
  else echo "$code_url (certificado $([[ $verify == 0 ]] && echo válido || echo "INVÁLIDO: $verify"))"; fi
}

case "$CMD" in
# ------------------------------------------------------------------ inspecionar
inspecionar)
  OUT="/root/mudar-dominio-inspecao.txt"
  {
    echo "== Inspeção $(date -Is) — $OLD → $NEW (IP desta VPS: ${MY_IP:-?})"
    echo; echo "== Sites do Nginx (nomes, destinos e redirecionamentos)"
    for f in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf; do
      [[ -e "$f" ]] || continue
      grep -Hn -E "server_name|proxy_pass|return 30" "$f" | grep -E "$OLD|proxy_pass|return" | sed 's/^/  /' || true
    done
    echo; echo "== Nomes (antigo → novo | DNS do novo aponta para esta VPS? | já adicionado?)"
    while IFS=$'\t' read -r h n ok added; do
      printf "  %-32s → %-32s DNS:%s  adicionado:%s\n" "$h" "$n" "$([[ $ok == 1 ]] && echo sim || echo NÃO)" "$([[ $added == 1 ]] && echo sim || echo não)"
    done < "$WORK/hosts.tsv"
    [[ -n "$EXCLUDE" ]] && echo "  (excluídos: $EXCLUDE)"
    echo; echo "== Outras referências a $OLD no Nginx (revise à mão)"
    grep -Rn "$OLD" /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null | grep -v -E "server_name|if \(\\\$host|ssl_certificate|# managed" | sed 's/^/  /' || echo "  nenhuma"
    echo; echo "== Certificados (nome | chave | domínios)"
    sed 's/^/  /' "$WORK/certs.tsv"
    echo; echo "== Hooks de renovação"
    ls -l /etc/letsencrypt/renewal-hooks/deploy/ 2>/dev/null | sed 's/^/  /' || true
    grep -H "renew_hook" /etc/letsencrypt/renewal/*.conf 2>/dev/null | sed 's/^/  /' || echo "  (nenhum renew_hook nos .conf)"
    echo; echo "== E-mail (docker-mailserver)"
    C=$(docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null | awk '/mailserver/{print $1; exit}' || true)
    if [[ -n "$C" ]]; then
      echo "  container: $C"
      echo "  caixas @$OLD: $(docker exec "$C" setup email list 2>/dev/null | grep -oE "[A-Za-z0-9._%+-]+@$OLD" | sort -u | tr '\n' ' ')"
      echo "  apelidos:"; docker exec "$C" setup alias list 2>/dev/null | sed 's/^/    /' || true
      docker exec "$C" sh -c 'echo "  rspamd=${ENABLE_RSPAMD:-0} opendkim=${ENABLE_OPENDKIM:-1} hostname=$(hostname -f) ssl=${SSL_TYPE:-}"' 2>/dev/null || true
    else
      echo "  nenhum container de e-mail encontrado"
    fi
  } | tee "$OUT"
  echo; echo "Salvo em $OUT"
  ;;

# ------------------------------------------------------------------ adicionar
adicionar)
  command -v certbot >/dev/null || { echo "Falta o certbot." >&2; exit 1; }
  awk -F'\t' '$3==1{print $1"\t"$2}' "$WORK/hosts.tsv" > "$WORK/selected.tsv"
  awk -F'\t' '$3!=1{print "  sem DNS ainda (fica para depois): "$2}' "$WORK/hosts.tsv"
  [[ -s "$WORK/selected.tsv" ]] || { echo "Nenhum nome novo com DNS apontando para ${MY_IP:-esta VPS}. Crie os registros e espere alguns minutos."; exit 1; }
  echo "== Nomes que serão adicionados:"; sed 's/\t/  →  /; s/^/  /' "$WORK/selected.tsv"
  [[ $SIMULATE == 1 ]] || backup
  echo "== Nginx"; edit_nginx add
  if [[ $SIMULATE == 0 ]]; then nginx_test_or_restore; systemctl reload nginx; fi

  echo "== Certificados"
  cp "$WORK/certs.tsv" "$WORK/certs-antes.tsv" # certs.tsv é regravado a cada ampliação
  while IFS=$'\t' read -r -u 3 name ktype doms; do
    extra=""
    for d in $doms; do
      n=$(awk -F'\t' -v h="$d" '$1==h{print $2}' "$WORK/selected.tsv")
      [[ -n "$n" && " $doms $extra " != *" $n "* ]] && extra="$extra $n"
    done
    [[ -n "$extra" ]] || continue
    all=$(echo $doms $extra | tr ' ' ',')
    echo "  $name: + $extra"
    cmdline=(certbot certonly --nginx --non-interactive --agree-tos --cert-name "$name" --expand -d "$all")
    [[ -n "$ktype" ]] && cmdline+=(--key-type "$ktype")
    if [[ $SIMULATE == 1 ]]; then echo "    (simulação) ${cmdline[*]}"; continue; fi
    if "${cmdline[@]}"; then
      certs; run_hooks "$name"
    else
      echo "  !! Falhou ao ampliar $name. Os sites continuam com o certificado anterior (o nome novo dá aviso de segurança até resolver)." >&2
    fi
  done 3< "$WORK/certs-antes.tsv"
  if [[ $SIMULATE == 0 ]]; then nginx -t && systemctl reload nginx; fi

  echo "== Conferência (código HTTP, destino, certificado)"
  while IFS=$'\t' read -r h n; do printf "  %-32s %s\n  %-32s %s\n" "$n" "$(check "$n")" "$h" "$(check "$h")"; done < "$WORK/selected.tsv"
  ;;

# ------------------------------------------------------------------ email
email)
  C=$(docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null | awk '/mailserver/{print $1; exit}' || true)
  [[ -n "$C" ]] || { echo "Container de e-mail não encontrado." >&2; exit 1; }
  echo "== Container: $C"
  docker exec "$C" setup email list > "$WORK/accounts.txt"
  { grep -oE "[A-Za-z0-9._%+-]+@$OLD" "$WORK/accounts.txt" || true; } | sort -u > "$WORK/boxes.txt"
  docker exec "$C" setup alias list > "$WORK/aliases.txt" 2>/dev/null || true
  [[ -s "$WORK/boxes.txt" ]] || { echo "Nenhuma caixa @$OLD encontrada."; exit 1; }
  while read -r -u 3 box; do
    local_part="${box%@*}"; alias="$local_part@$NEW"
    if grep -qE "(^|[^A-Za-z0-9._%+-])$alias([^A-Za-z0-9._%+-]|$)" "$WORK/aliases.txt" "$WORK/accounts.txt"; then
      echo "  já existe: $alias"; continue
    fi
    echo "  apelido: $alias → $box"
    [[ $SIMULATE == 1 ]] || docker exec "$C" setup alias add "$alias" "$box"
  done 3< "$WORK/boxes.txt"

  echo "== DKIM de $NEW"
  if [[ $SIMULATE == 1 ]]; then echo "  (simulação) docker exec $C setup config dkim domain $NEW && docker restart $C"; exit 0; fi
  docker exec "$C" setup config dkim domain "$NEW"
  echo "  reiniciando $C para ativar a assinatura…"; docker restart "$C" >/dev/null
  KEYFILE=$(docker exec "$C" sh -c "ls /tmp/docker-mailserver/opendkim/keys/$NEW/*.txt /tmp/docker-mailserver/rspamd/dkim/*$NEW*.txt 2>/dev/null | head -1" || true)
  if [[ -n "$KEYFILE" ]]; then
    SEL=$(basename "$KEYFILE" .txt); SEL="${SEL%%-*}"; [[ "$SEL" == rsa* ]] && SEL=mail
    VAL=$(docker exec "$C" cat "$KEYFILE" | python3 -c "import re,sys; print(''.join(re.findall(r'\"([^\"]*)\"', sys.stdin.read())))")
    echo
    echo "Crie no DNS de $NEW:  TXT  ${SEL}._domainkey  com o valor (uma linha só):"
    echo "$VAL"
  else
    echo "  Chave criada; não achei o arquivo .txt para mostrar. Veja: docker exec $C setup config dkim help"
  fi
  ;;

# ------------------------------------------------------------------ redirecionar
redirecionar)
  # Só redireciona nomes que já respondem pelo novo (rodou "adicionar") e cujo certificado cobre os dois.
  : > "$WORK/selected.tsv"
  while IFS=$'\t' read -r h n ok added; do
    cert=$(awk -F'\t' -v h="$h" -v n="$n" '{split($3,a," "); f1=f2=0; for(i in a){if(a[i]==h)f1=1; if(a[i]==n)f2=1} if(f1&&f2){print $1; exit}}' "$WORK/certs.tsv")
    if [[ $added == 1 && -n "$cert" ]]; then printf "%s\t%s\t%s\n" "$h" "$n" "$cert" >> "$WORK/selected.tsv"
    else echo "  pulando $h (rode 'adicionar' antes: adicionado=$added, certificado com os dois nomes=${cert:-não})"; fi
  done < "$WORK/hosts.tsv"
  [[ -s "$WORK/selected.tsv" ]] || { echo "Nada para redirecionar."; exit 1; }
  echo "== Vão redirecionar (301):"; awk -F'\t' '{print "  "$1"  →  https://"$2}' "$WORK/selected.tsv"
  [[ $SIMULATE == 1 ]] || backup

  V6=0; grep -Rqs 'listen \[::\]:443' /etc/nginx/sites-enabled/ && V6=1
  RF="/etc/nginx/sites-available/redirecionar-$OLD"
  {
    echo "# Gerado por mudar-dominio.sh em $(date -Is): $OLD → $NEW"
    echo "# O desafio do Let's Encrypt (location exata do certbot) continua tendo prioridade."
    while IFS=$'\t' read -r h n cert; do
      cat <<EOF
server {
    listen 80;$([[ $V6 == 1 ]] && printf '\n    listen [::]:80;')
    server_name $h;
    location / { return 301 https://$n\$request_uri; }
}
server {
    listen 443 ssl;$([[ $V6 == 1 ]] && printf '\n    listen [::]:443 ssl;')
    server_name $h;
    ssl_certificate /etc/letsencrypt/live/$cert/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$cert/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    location / { return 301 https://$n\$request_uri; }
}
EOF
    done < "$WORK/selected.tsv"
  } > "$WORK/redirect.conf"

  echo "== Nginx (sites atuais)"; cut -f1,2 "$WORK/selected.tsv" > "$WORK/sel2.tsv"; mv "$WORK/sel2.tsv" "$WORK/selected.tsv"
  edit_nginx redirect
  echo "== Novo arquivo $RF"; cat "$WORK/redirect.conf"
  [[ $SIMULATE == 1 ]] && exit 0
  cp "$WORK/redirect.conf" "$RF"; ln -sf "$RF" "/etc/nginx/sites-enabled/redirecionar-$OLD"
  nginx_test_or_restore; systemctl reload nginx

  echo "== Conferência"
  while IFS=$'\t' read -r h n; do printf "  %-32s %s\n  %-32s %s\n" "$h" "$(check "$h")" "$n" "$(check "$n")"; done < "$WORK/selected.tsv"
  echo "== Teste de renovação (não muda nada)"
  certbot renew --dry-run 2>&1 | tail -6 || echo "!! Teste de renovação falhou. Veja: certbot renew --dry-run"
  ;;
esac
