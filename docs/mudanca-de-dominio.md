# Mudança de domínio

Como trocar o endereço do MapsControl (e, se quiser, de todos os sites da VPS) sem tirar nada do ar. Os exemplos usam `antigo.com.br` → `novo.com.br`.

## Como funciona

| Fase | O que acontece |
|---|---|
| **1. Os dois endereços** | O site responde pelo nome antigo e pelo novo, cada um com certificado válido. Quem entra pelo antigo vê um aviso com o novo endereço, a data da mudança e o botão **Abrir novo endereço**. Os links dos e-mails já levam ao endereço novo. |
| **2. Redirecionamento** (na data do aviso) | O nome antigo passa a responder `301` para o novo, mantendo o caminho (`/c/…`, `#t=…` dos links de e-mail). A renovação dos certificados continua funcionando. |

O que a pessoa precisa saber (está no aviso):

- **Entrar de novo.** O login fica preso ao endereço. Os cookies são por domínio, e o `__Host-` impede compartilhar. O e-mail e a senha continuam os mesmos.
- **Instalar o app de novo.** O app instalado (PWA) também fica preso ao endereço. No endereço antigo, o convite para instalar some, para ninguém instalar a versão que vai deixar de existir.

## Passo a passo

### 1. DNS

Crie, no domínio novo, os mesmos nomes do antigo (registro `A` para o IP da VPS). No antigo não muda nada.

### 2. Inspeção (só leitura)

```bash
cd /root/mapscontrol/deploy
bash scripts/mudar-dominio.sh inspecionar antigo.com.br novo.com.br
```

Mostra:

- todos os sites do Nginx;
- qual nome novo corresponde a cada nome antigo e se o DNS dele já aponta para a VPS;
- os certificados e os hooks de renovação;
- outras referências ao domínio antigo, para revisar à mão;
- o e-mail, quando houver docker-mailserver.

### 3. Adicionar os nomes novos

```bash
nohup bash scripts/mudar-dominio.sh adicionar antigo.com.br novo.com.br --excluir api.antigo.com.br > /root/mudar-dominio.log 2>&1 &
tail -f /root/mudar-dominio.log
```

- Antes de mexer, faz backup de `/etc/nginx` e `/etc/letsencrypt` em `/root/backup-dominio-*.tgz`. Se o `nginx -t` falhar, volta sozinho.
- Acrescenta o nome novo ao lado do antigo em cada `server_name`, incluindo os redirecionamentos HTTP→HTTPS do Certbot.
- Amplia cada certificado para os nomes novos com `certbot certonly --nginx --expand`, mantendo o tipo de chave. Depois roda os hooks de renovação, por exemplo a cópia do certificado para o servidor de e-mail.
- Só entram os nomes cujo DNS já aponta para a VPS. Os outros ficam para quando o DNS estiver pronto. É só rodar de novo, porque o script não repete o que já foi feito.
- Use `--simular` para ver as mudanças sem aplicar.
- Use `--excluir` para nomes que não devem mudar. Por exemplo, uma API que recebe POST de outros sistemas, porque esses sistemas normalmente não seguem redirecionamento.

### 4. Ligar o aviso no MapsControl

```bash
bash scripts/mudar-endereco-app.sh https://mapscontrol.novo.com.br 2026-10-23
```

- Só continua se `https://mapscontrol.novo.com.br/api/health` já responder com certificado válido.
- Guarda uma cópia do `.env` em `.env.antes-mudanca-*`.
- Ajusta três variáveis:
  - `APP_ORIGIN` passa a ser o endereço novo;
  - `EXTRA_ORIGINS` recebe o endereço antigo, que continua aceito pela proteção CSRF;
  - `ADDRESS_CHANGE_DATE` recebe a data mostrada no aviso.
- Implanta com `scripts/deploy.sh`, que tem rollback automático.

### 5. E-mail (opcional)

```bash
bash scripts/mudar-dominio.sh email antigo.com.br novo.com.br
```

- Para cada caixa do domínio antigo, cria no domínio novo um apelido com o mesmo nome antes do @. As mensagens caem na mesma caixa, e a senha e o login continuam os mesmos.
- Gera a chave DKIM do domínio novo e mostra o registro TXT para criar no DNS.
- Se o DNS de `mail.novo.com.br` já aponta para a VPS, inclui esse nome no certificado do servidor de e-mail e roda o hook que copia o certificado para o container.
- Reinicia o container de e-mail uma vez, o que leva cerca de 30 s. Rodar de novo não repete o que já foi feito.

Registros DNS do domínio novo para o e-mail:

| Tipo | Nome | Valor |
|---|---|---|
| MX | *(raiz)* | `mail.novo.com.br`, prioridade 10 |
| A | `mail` | IP da VPS |
| TXT | *(raiz)* | `v=spf1 ip4:IP.DA.VPS mx ~all` |
| TXT | `_dmarc` | `v=DMARC1; p=none` |
| TXT | `mail._domainkey` | valor mostrado pelo script |

### 6. Na data: redirecionar

```bash
nohup bash scripts/mudar-dominio.sh redirecionar antigo.com.br novo.com.br \
  --excluir api.antigo.com.br,mail.antigo.com.br \
  --manter-caminhos /webhook,/deploy > /root/mudar-dominio.log 2>&1 &
```

- Com `--manter-caminhos`, os caminhos listados continuam funcionando no endereço antigo. O pedido é repassado, por dentro do próprio Nginx, ao mesmo caminho do endereço novo, com corpo e cabeçalhos (assinaturas incluídas). Use isso para webhooks de pagamento, de deploy e de mensagens. O caminho só é mantido nos nomes cujo site atual tem esse `location`.

- Tira os nomes antigos dos sites e cria `/etc/nginx/sites-available/redirecionar-antigo.com.br` com um `301` por nome. O `301` fica em `location /`, para que o desafio do Let's Encrypt continue tendo prioridade.
- Ajusta os redirecionamentos internos (ex.: `www` → raiz) para o domínio novo.
- No fim, roda `certbot renew --dry-run` para confirmar que a renovação continua funcionando.
- Deixe de fora:
  - o nome do servidor de e-mail, que os programas de e-mail e o MX do domínio antigo continuam usando;
  - APIs que recebem POST;
  - apps que guardam dados no navegador e ainda não avisaram os usuários (veja abaixo).

### 7. Depois de algumas semanas

- Deixe `ADDRESS_CHANGE_DATE` vazio no `.env` e rode `bash scripts/deploy.sh`. Isso tira a frase "Este é o novo endereço" da tela de entrada.
- `EXTRA_ORIGINS` pode ficar. Com o redirecionamento ativo, nenhum pedido chega mais pelo endereço antigo.
- Mantenha o domínio antigo registrado e o redirecionamento ativo por pelo menos um ano. Há links antigos em e-mails, favoritos e mensagens.

## Desfazer

```bash
bash scripts/mudar-dominio.sh desfazer /root/backup-dominio-AAAAMMDD-HHMMSS.tgz   # Nginx e certificados
cp deploy/.env.antes-mudanca-AAAAMMDD-HHMMSS deploy/.env && bash scripts/deploy.sh # MapsControl
```

Navegadores guardam o `301` por algum tempo. Quem já foi redirecionado pode continuar indo para o endereço novo até limpar o cache.

## Cuidados

- **Apps com dados guardados no navegador** (IndexedDB/localStorage) perdem acesso a esses dados quando o endereço muda, porque cada domínio tem o seu armazenamento. Antes de redirecionar um app assim, avise os usuários e ofereça um caminho, como sincronizar ou exportar. O MapsControl não tem esse problema: os dados ficam no servidor.
- **Android (TWA):** o app abre o endereço de `android/gradle.properties` (`mapscontrol.host`). Antes da primeira publicação basta trocar o host. Depois de publicado, é preciso lançar uma versão nova e manter o `assetlinks.json` respondendo nos dois endereços.
- **Webhooks** de outros serviços (GitHub, WhatsApp etc.) não seguem `301`. Atualize a URL no serviço ou deixe o nome fora do redirecionamento.
