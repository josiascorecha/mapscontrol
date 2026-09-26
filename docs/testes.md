# Testes e critérios de aceitação

| # | Critério | Onde é verificado | Como rodar |
|---|---|---|---|
| 1 | Casa sem contato permanece pendente (inclusive após ausência) | `server/test/status.test.ts` › *1.* | `cd server && npm test` |
| 2 | Carta mantém a pendência e registra a data | `status.test.ts` › *2.*; E2E (chip "Com carta") | idem |
| 3 | Contato registra a data da conversa; carta/ausência posteriores não apagam o contato | `status.test.ts` › *3.*; E2E | idem |
| 4 | Cada apartamento tem histórico próprio | `status.test.ts` › *4.*; E2E (prédio) | idem |
| 5 | Publicador não acessa outra congregação (leitura, escrita e ids "cruzados") | `permissions.test.ts` › *5.* | idem |
| 6 | Publicador não executa funções administrativas (14 rotas) | `permissions.test.ts` › *6.*; E2E (sem botões de administrador) | idem |
| 7 | Administrador cria a congregação sem aprovação | `permissions.test.ts` › *7.*; E2E | idem |
| 8 | Código não pode ser reutilizado (sequencial e **concorrente**), expira, pode ser cancelado, libera só Publicador, tem limite de tentativas | `codes.test.ts` › *8.* | idem |
| 9 | Revogação bloqueia sessões já abertas (dois aparelhos) | `codes.test.ts` › *9.*; E2E (publicador volta para Entrar) | idem |
| 10 | Administrador Geral vê e edita todas as congregações, com auditoria; não é obtível por parâmetros do cliente | `permissions.test.ts` › *10.* | idem |
| 11 | Registros persistem após reiniciar o serviço (novo processo e novo pool) | `persistence.test.ts` | idem |
| 12 | Interface funciona em celular (Pixel 7) e computador (1280×800), sem rolagem horizontal; erro de rede preserva o que foi digitado; tema claro/escuro | `web/e2e/fluxo.spec.ts` | servidor rodando + `cd web && npx playwright test` |
| 13 | Nenhuma credencial ou dado real no material público | `scripts/check-public.sh` (também no CI) | `bash scripts/check-public.sh` |
| 14 | Backup e restauração verificáveis | `scripts/test-backup-restore.sh` (dump → apaga o banco → restaura → compara); `deploy/scripts/verify-backup.sh` na VPS | ver README |

Outros testes: autenticação (confirmação obrigatória, anti-enumeração, Argon2id, recuperação de senha que encerra sessões, logout no servidor, cookie HttpOnly/SameSite), exclusão de conta com anonimização, CSRF por Origin, resolução segura de links do Maps (domínios, IPs internos, limite de redirecionamentos, "não inventa coordenadas").

## Última execução (ambiente de desenvolvimento, 26/09/2026)

- Servidor: **56/56 testes** passando (6 arquivos), PostgreSQL 16.
- E2E: **4/4** (fluxo completo + tema, em celular e computador), Chromium 141.
- Backup/restauração: OK (80 registros, 32 apartamentos, 2 usuários restaurados idênticos).
- `check-public.sh`: nenhum dado privado encontrado.

**Não verificado:** `docker build`/`docker compose up` e build Android (sem acesso a registros externos no ambiente).
