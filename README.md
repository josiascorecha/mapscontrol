# MapsControl

Gestão de territórios, quadras e registro de visitas para congregações. Funciona no navegador e como aplicativo Android. Substitui o controle em papel.

> **Estado real do projeto (setembro/2026):** código funcional com testes automatizados passando localmente. Ainda **não está em produção** nem publicado na Google Play. A imagem Docker e o Android App Bundle **ainda não foram compilados**, porque o ambiente de desenvolvimento não tinha acesso ao Docker Hub nem ao Google Maven. Veja [Limitações e próximos passos](#limitações-e-próximos-passos).

![Telas do MapsControl (dados fictícios)](docs/screenshots/02-inicio.png)

## O problema

O controle em papel tem vários problemas:

- não mostra em tempo real quais casas já tiveram conversa;
- mistura a data de uma carta com a data de um contato;
- se perde com facilidade;
- não permite que vários publicadores trabalhem ao mesmo tempo, cada um no próprio celular.

## A solução

- **Hierarquia:** Congregação → Território → Quadra → Casa ou Prédio → Apartamento → histórico de registros.
- **Três situações por casa ou apartamento**, sempre calculadas a partir do histórico:
  - **Pendente:** nenhum contato e nenhuma carta. Tentativas sem ninguém em casa entram só no histórico.
  - **Com carta:** carta deixada, com a data da carta. A pendência continua até haver conversa.
  - **Contato realizado:** mostra a data da conversa. Cartas ou ausências registradas depois **não apagam** o contato.
- **Histórico imutável:** cada registro guarda ação, data, autor e observação. Um registro errado é *anulado* (continua visível, riscado), nunca apagado.
- **Prédios:**
  - cadastro de apartamentos em lote (por andares ou por lista), com revisão antes de salvar;
  - bloco ou torre opcional;
  - situação e histórico próprios de cada apartamento;
  - tela específica "Prédios e cartas", com a lista das cartas pendentes.
- **Mapa** (Leaflet + OpenStreetMap):
  - marcadores numerados por quadra;
  - "Abrir endereços" e "Abrir no Google Maps";
  - posição por link do Google Maps (resolvido com segurança no servidor), por toque no mapa ou por latitude/longitude.
- **Perfis:**
  - **Publicador:** entra com um código individual, de uso único.
  - **Administrador:** cria a própria congregação, sem aprovação de ninguém, e gerencia territórios, quadras, membros e códigos.
  - **Administrador Geral:** faz o suporte a todas as congregações, com todas as ações auditadas. Esse perfil só é concedido por um script no servidor.
- **Interface:** pensada para pessoas com pouca familiaridade com tecnologia:
  - botões de 52 px e uso com uma mão;
  - registro de visita em 2 toques, com a data de hoje já preenchida;
  - tema claro, escuro ou automático.

| | | | |
|---|---|---|---|
| ![Território](docs/screenshots/03-territorio-mapa.png) | ![Quadra](docs/screenshots/04-quadra.png) | ![Registro rápido](docs/screenshots/05-registro-rapido.png) | ![Prédio](docs/screenshots/06-predio-apartamentos.png) |
| Território e mapa¹ | Quadra | Registro rápido | Apartamentos |
| ![Tema escuro](docs/screenshots/07-inicio-escuro.png) | ![Código](docs/screenshots/08-codigo-escuro.png) | ![Entrar](docs/screenshots/01-entrar.png) | |
| Tema escuro | Código de acesso | Entrar | |

¹ As capturas foram feitas num ambiente sem acesso às imagens do OpenStreetMap, por isso o fundo do mapa aparece liso. Todos os dados são fictícios.

## Arquitetura e tecnologias

```
Navegador / App Android (TWA) ──HTTPS──▶ Proxy reverso da VPS (Nginx/Caddy/Traefik)
                                             │
                                             ▼  127.0.0.1:8087
                                  ┌──────────────────────────┐
                                  │ mapscontrol-app (Node 22)│  API REST + interface web (mesma origem)
                                  └────────────┬─────────────┘
                                               │ rede interna Docker
                         ┌─────────────────────┴───────────────┐
                         ▼                                     ▼
              mapscontrol-db (PostgreSQL 16)        mapscontrol-backup (pg_dump diário, 30 dias)
```

| Camada | Escolha | Por quê |
|---|---|---|
| API | Node 22 + TypeScript + Fastify 5 | Leve para uma VPS pequena; validação com Zod |
| Banco | PostgreSQL 16, migrações SQL versionadas | Transações, chaves compostas que garantem o isolamento entre congregações, e uma *view* que calcula a situação a partir do histórico |
| Sessões | Token opaco em cookie `__Host-` HttpOnly/Secure/SameSite, guardado como SHA-256 | A revogação vale na requisição seguinte, inclusive em sessões já abertas |
| Senhas | Argon2id (m=19 MiB, t=2) | Recomendação da OWASP |
| Códigos de acesso | CSPRNG, 12 caracteres, guardados como HMAC-SHA256, consumidos de forma atômica | Não podem ser reutilizados nem adivinhados |
| Web | React 19 + Vite + Leaflet, PWA sem cache de dados | Um só código para navegador e Android |
| Android | Trusted Web Activity (androidbrowserhelper) | Mesmo backend e mesma interface; ver [docs/android-google-play.md](docs/android-google-play.md) |
| Implantação | Docker Compose isolado (projeto `mapscontrol`) | Não interfere nos outros serviços da VPS |

Os detalhes estão em [docs/arquitetura.md](docs/arquitetura.md).

## Executar localmente

Requisitos: Node 22 e PostgreSQL 16.

```bash
# banco
createuser -P mapscontrol          # defina uma senha local
createdb -O mapscontrol mapscontrol_dev

# servidor (API em http://localhost:3000)
cd server
npm install
export DATABASE_URL=postgres://mapscontrol:SUA_SENHA@localhost:5432/mapscontrol_dev
export CODE_PEPPER=$(openssl rand -hex 32) MAIL_TRANSPORT=file
npm run build && DEMO_PASSWORD=uma-senha-local npm run seed:demo   # dados fictícios opcionais
npm run dev

# interface (http://localhost:5173, com proxy para a API)
cd ../web
npm install
npm run dev
```

Em desenvolvimento, os e-mails de confirmação são gravados como arquivos em `server/.dev-mail/`.

## Testes

```bash
createdb -O mapscontrol mapscontrol_test
cd server && TEST_DATABASE_URL=postgres://mapscontrol:SUA_SENHA@localhost:5432/mapscontrol_test npm test   # 56 testes de integração
cd web && npm run build && npx playwright test          # E2E celular + computador (servidor rodando com STATIC_DIR=../web/dist)
PGHOST=localhost PGUSER=mapscontrol PGPASSWORD=... scripts/test-backup-restore.sh
scripts/check-public.sh                                  # nenhum dado real/segredo no repositório
```

O mapa entre os critérios de aceitação e os testes está em [docs/testes.md](docs/testes.md).

## Implantação

Guia completo em [docs/implantacao-vps.md](docs/implantacao-vps.md). O guia cobre:

- inspeção da VPS, somente leitura;
- configuração do proxy;
- deploy com rollback automático;
- configuração do Administrador Geral;
- backup, verificação e restauração.

## Limitações e próximos passos

- **Não verificado neste ambiente:**
  - o `docker build`, porque o Docker Hub estava bloqueado;
  - a compilação do AAB Android, porque o Google Maven estava bloqueado;
  - a resolução de links curtos pela rede a partir do servidor. A lógica foi testada com respostas simuladas, e o formato foi confirmado com links reais.
- **Offline:** não há funcionamento offline. O aplicativo avisa quando está sem conexão e não salva nada sem o servidor.
- **Termos e privacidade:** as versões são preliminares. Precisam de revisão jurídica, em especial por envolver dado sensível (convicção religiosa, LGPD art. 11).
- **Instância única:** a arquitetura é de uma instância, suficiente para centenas de usuários. Para escalar horizontalmente, basta mais de um container, porque as sessões e os limites de tentativas já ficam no PostgreSQL.
- **Próximos passos:**
  - exportação para planilha (CSV/Google Sheets);
  - relatório por período;
  - notificações opcionais;
  - modo offline com fila de sincronização, depois de especificado e testado.

## Licença

Ainda não definida pelo titular do projeto. Até lá, todos os direitos estão reservados.
