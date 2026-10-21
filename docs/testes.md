# Testes e critérios de aceitação

| # | Critério | Onde é verificado | Como rodar |
|---|---|---|---|
| 1 | Casa sem contato permanece pendente (inclusive após ausência) | `server/test/status.test.ts` › *1.* | `cd server && npm test` |
| 2 | Carta mantém a pendência e registra a data | `status.test.ts` › *2.*; E2E (chip "Com carta") | idem |
| 3 | Contato registra a data da conversa; carta/ausência posteriores não apagam o contato | `status.test.ts` › *3.*; E2E | idem |
| 4 | Cada apartamento tem histórico próprio | `status.test.ts` › *4.*; E2E (prédio) | idem |
| 5 | Publicador não acessa outra congregação (leitura, escrita e ids "cruzados") | `permissions.test.ts` › *5.* | idem |
| 6 | Publicador não executa funções administrativas: não confirma, não exclui o que foi confirmado, não gerencia membros e códigos | `permissions.test.ts` › *6.*; E2E (sem botões de administrador) | idem |
| 7 | Administrador cria a congregação sem aprovação | `permissions.test.ts` › *7.*; E2E | idem |
| 8 | Código não pode ser reutilizado (sequencial e **concorrente**), expira, pode ser cancelado, libera só Publicador, tem limite de tentativas | `codes.test.ts` › *8.* | idem |
| 9 | Revogação bloqueia sessões já abertas (dois aparelhos) | `codes.test.ts` › *9.*; E2E (publicador volta para Entrar) | idem |
| 10 | Administrador Geral vê e edita todas as congregações, com auditoria; não é obtível por parâmetros do cliente | `permissions.test.ts` › *10.* | idem |
| 11 | Registros persistem após reiniciar o serviço (novo processo e novo pool) | `persistence.test.ts` | idem |
| 12 | Interface funciona em celular (Pixel 7) e computador (1280×800), sem rolagem horizontal; erro de rede preserva o que foi digitado; tema claro/escuro | `web/e2e/fluxo.spec.ts` | servidor rodando + `cd web && npx playwright test` |
| 13 | Nenhuma credencial ou dado real no material público | `scripts/check-public.sh` (também no CI) | `bash scripts/check-public.sh` |
| 14 | Backup e restauração verificáveis | `scripts/test-backup-restore.sh` (dump → apaga o banco → restaura → compara); `deploy/scripts/verify-backup.sh` na VPS | ver README |

Cadastro pelo publicador: `server/test/structure-ownership.test.ts` e `web/e2e/publicador-estrutura.spec.ts`. Cobrem:

- território e quadra aguardando confirmação;
- exclusão só por quem cadastrou e só antes da confirmação, bloqueada quando há casas ou visitas de outras pessoas;
- confirmação individual e "confirmar todos";
- edição depois de confirmado;
- exclusão das próprias casas e apartamentos.

Fichas para recorte: `server/test/cards-pdf.test.ts`. Cobre:

- 36 endereços por ficha, com continuação;
- ordem de cadastro;
- data do contato ou da carta;
- apartamentos como "120/101";
- nomes no campo PUBLICADORES;
- 4 fichas por folha.

Mudança de domínio: `server/test/domain-change.test.ts` (endereço antigo aceito durante a transição, outras origens recusadas, links de e-mail sempre no endereço novo, validação da configuração) e `web/e2e/mudanca-endereco.spec.ts` (aviso só no endereço antigo, botão com o mesmo caminho, sem convite para instalar no endereço antigo). O script `deploy/scripts/mudar-dominio.sh` foi exercitado com Nginx real e Certbot simulado (adicionar → redirecionar → desfazer).

Outros testes: autenticação (confirmação obrigatória, anti-enumeração, Argon2id, recuperação de senha que encerra sessões, logout no servidor, cookie HttpOnly/SameSite), exclusão de conta com anonimização, CSRF por Origin, resolução segura de links do Maps (domínios, IPs internos, limite de redirecionamentos, "não inventa coordenadas").

## Última execução (ambiente de desenvolvimento, 21/10/2026)

- Servidor: **97/97 testes** passando (12 arquivos), PostgreSQL 16.
- E2E: **17/17** em celular e computador. Um teste de mapa só roda no computador.
- `check-public.sh`: nenhum dado privado encontrado.
- Backup/restauração: verificado em 26/09/2026 (80 registros, 32 apartamentos, 2 usuários restaurados idênticos).

A imagem Docker é construída e verificada na VPS pelo `deploy/scripts/deploy.sh`, que confere a saúde e faz rollback automático. O build Android ainda não foi feito.
