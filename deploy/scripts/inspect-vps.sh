#!/usr/bin/env bash
# Inspeção SOMENTE LEITURA da VPS antes da implantação. Não altera nada.
# Uso:  bash inspect-vps.sh > inspecao.txt   (depois envie o arquivo para revisão)
# O relatório não inclui variáveis de ambiente nem segredos dos containers.
DOMAIN="${1:-mapscontrol.j2bot.com.br}"
PORT_WANTED="${2:-8087}"
sec() { printf '\n===== %s =====\n' "$1"; }

sec "Sistema"
uname -a; (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"); uptime
sec "Recursos"
free -h; df -h / /var/lib/docker 2>/dev/null
sec "Docker"
docker version --format 'cliente {{.Client.Version}} / servidor {{.Server.Version}}' 2>&1
docker compose version 2>&1
sec "Containers (nome, imagem, estado, portas)"
docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' 2>&1
sec "Projetos compose"
docker compose ls 2>&1
sec "Redes Docker"
docker network ls 2>&1
sec "Volumes Docker"
docker volume ls 2>&1
sec "Portas em escuta no host"
(ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null) | sed 's/users:.*//' 
sec "Porta desejada ${PORT_WANTED}"
if ss -tln 2>/dev/null | grep -q ":${PORT_WANTED}\b"; then echo "OCUPADA — escolha outra APP_PORT"; else echo "livre"; fi
sec "Proxy reverso detectado"
for s in nginx caddy apache2 httpd traefik; do systemctl is-active "$s" 2>/dev/null | sed "s/^/$s (systemd): /"; done
docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null | grep -Ei 'traefik|nginx|caddy|proxy|npm' || echo "nenhum container de proxy óbvio"
sec "Configuração Nginx (arquivos e server_name)"
ls -1 /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null
grep -rhoE 'server_name[^;]+' /etc/nginx 2>/dev/null | sort -u
sec "Caddyfile (domínios)"
grep -hE '^[a-z0-9.*-]+\.[a-z]{2,}' /etc/caddy/Caddyfile 2>/dev/null || echo "sem /etc/caddy/Caddyfile"
sec "Traefik (labels de roteamento nos containers)"
for c in $(docker ps -q 2>/dev/null); do docker inspect --format '{{.Name}} {{range $k,$v := .Config.Labels}}{{if or (eq (printf "%.15s" $k) "traefik.http.ro") (eq $k "traefik.docker.network")}}{{$k}}={{$v}} {{end}}{{end}}' "$c"; done 2>/dev/null | grep traefik || echo "nenhum"
sec "Certificados"
ls -1 /etc/letsencrypt/live 2>/dev/null || echo "sem /etc/letsencrypt/live"
sec "DNS do domínio ${DOMAIN}"
getent hosts "$DOMAIN" || echo "domínio ainda não resolve"
echo "IP público desta VPS: $(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo desconhecido)"
sec "Firewall"
(ufw status 2>/dev/null || echo "ufw indisponível") | head -20
sec "Fim"
echo "Nada foi alterado."
