# Implantação na VPS (Ubuntu + Docker)

Este guia supõe uma VPS que **já tem outros serviços**. Todo o procedimento foi desenhado para não tocar neles:

- projeto Compose próprio (`mapscontrol`), com containers, rede e volumes com prefixo `mapscontrol`;
- nenhuma porta pública nova: a aplicação escuta só em `127.0.0.1:APP_PORT` e o proxy reverso existente encaminha o subdomínio para ela;
- nenhuma alteração em DNS de e-mail nem em outros subdomínios.

## 0. Inspeção (somente leitura)

```bash
git clone <URL-do-repositório> ~/mapscontrol && cd ~/mapscontrol/deploy
bash scripts/inspect-vps.sh mapscontrol.SEU-DOMINIO 8087 > ~/inspecao-mapscontrol.txt
```

O script lista:

- containers, portas em uso, redes e volumes;
- qual proxy está ativo (Nginx, Caddy ou Traefik) e os domínios já configurados;
- os certificados existentes;
- o firewall;
- se o subdomínio já aponta para a VPS.

**Nada é alterado.** Leia o relatório antes de continuar. Se a porta 8087 estiver ocupada, escolha outra `APP_PORT`.

## 1. DNS

No painel DNS do domínio, crie **somente** um registro `A` para o subdomínio (ex.: `mapscontrol`), apontando para o IP da VPS. Não altere MX, SPF, DKIM nem outros registros.

## 2. Configuração privada

```bash
cd ~/mapscontrol/deploy
cp .env.example .env && chmod 600 .env
openssl rand -hex 32   # use para POSTGRES_PASSWORD
openssl rand -hex 32   # use para CODE_PEPPER (nunca troque depois: invalida os códigos pendentes)
nano .env              # APP_ORIGIN, SMTP, CONTACT_EMAIL…
```

- O `.env` e a pasta `deploy/private/` são ignorados pelo Git.
- **Nunca** coloque credenciais no repositório nem em mensagens.
- **E-mail:** use um SMTP transacional ou o SMTP do domínio. Sem SMTP funcionando, ninguém consegue confirmar o cadastro. Para que as mensagens não caiam no spam, o remetente (`MAIL_FROM`) deve ser de um domínio com SPF/DKIM válidos.

## 3. Primeiro deploy

```bash
bash scripts/deploy.sh
```

Etapas executadas pelo script:

1. marca a imagem atual como `previous`;
2. faz um backup, quando já existe banco;
3. constrói a imagem;
4. sobe `db`, `app` e `backup`;
5. testa `http://127.0.0.1:APP_PORT/api/health`.

Se a verificação de saúde falhar, o script **reverte automaticamente** para a imagem anterior.

## 4. Proxy reverso e HTTPS

Use o que a inspeção encontrou:

- **Nginx no host:** `proxy/nginx-mapscontrol.conf`, depois `certbot --nginx -d mapscontrol.SEU-DOMINIO`.
- **Caddy:** `proxy/Caddyfile.snippet`. O HTTPS é automático.
- **Traefik em container:** `proxy/docker-compose.traefik.yml`, com o nome da rede e do certresolver ajustados. Suba com os dois arquivos `-f`.

Confira em `https://mapscontrol.SEU-DOMINIO/api/health`.

## 5. Administrador Geral

```bash
bash scripts/bootstrap-global-admin.sh "email@dominio" "Nome Completo"
```

O script cria (ou promove) a conta e envia um **link de ativação** por e-mail, válido por 72 h, para definir a senha.

- Não existe senha fixa.
- O script não imprime o link.
- Nenhuma rota da API concede esse perfil.

## 6. Congregação e território inicial

1. O responsável se cadastra no site como **Administrador** e cria a congregação.
2. Para importar quadras de um arquivo privado, siga o formato de `territorio.exemplo.json`:
   ```bash
   # obter o id da congregação
   docker compose --env-file .env exec db psql -U mapscontrol -c "select id, name from congregations"
   bash scripts/import-territory.sh <id> private/territorio.json
   ```
   Também dá para cadastrar pela interface, colando os links do Google Maps em "Nova quadra → Buscar posição pelo link".

## 7. Backups

- O container `mapscontrol-backup` faz um `pg_dump` por dia às `BACKUP_HOUR`h, com checksum SHA-256, e mantém `BACKUP_KEEP_DAYS` dias em `deploy/backups/`.
- **Cópia fora da VPS (recomendado):** sincronize `deploy/backups/` com outro lugar, por exemplo com `rclone` para um armazenamento em nuvem, por agendamento do host.
- Backup imediato: `bash scripts/backup-now.sh`.
- **Verificação de restauração** (sem tocar na produção):
  ```bash
  bash scripts/verify-backup.sh            # usa o dump mais recente
  ```
  O script restaura o dump num banco temporário, compara a contagem de linhas de cada tabela com o banco atual e apaga o banco temporário. Rode uma vez por mês e depois de cada mudança de versão.
- **Restauração real:**
  ```bash
  bash scripts/restore.sh backups/mapscontrol-AAAAMMDD-HHMMSS.dump
  ```
  Etapas do script:
  1. pede confirmação;
  2. faz um backup do estado atual;
  3. renomeia o banco atual para `mapscontrol_old`;
  4. restaura o dump;
  5. religa a aplicação.

  Se algo falhar, o banco anterior volta.

## 8. Atualizações e rollback

```bash
cd ~/mapscontrol && git pull && cd deploy && bash scripts/deploy.sh
bash scripts/rollback.sh        # volta para a imagem anterior
```

- As migrações de banco só avançam.
- Se uma versão nova alterar o esquema e for preciso voltar, restaure também o backup pré-deploy: `bash scripts/restore.sh "$(cat backups/.pre-deploy)"`.

## 9. Remoção completa (se um dia for necessária)

```bash
docker compose --env-file .env down          # mantém os dados (volume)
docker compose --env-file .env down -v       # APAGA o banco (faça backup antes)
```

Isso não afeta os outros containers da VPS.

## Pontos a verificar na primeira implantação

- **`docker build` na VPS:** não foi possível testar no ambiente de desenvolvimento. Acompanhe a primeira execução.
- **Resolução de links curtos (`maps.app.goo.gl`):** depende de a VPS conseguir acessar o Google. Se falhar, a interface pede o posicionamento manual.
- **Tiles do OpenStreetMap:** a [política de uso](https://operations.osmfoundation.org/policies/tiles/) permite uso leve, com atribuição. Se o volume crescer, troque `TILE_URL` por um provedor próprio ou pago.
