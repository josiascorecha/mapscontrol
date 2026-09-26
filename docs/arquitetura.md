# Arquitetura

## Visão geral

Um único processo Node serve a API (`/api/*`) e a interface web (SPA). O navegador e o aplicativo Android (TWA) acessam **a mesma origem HTTPS**. Por isso:

- os dados são os mesmos nos dois;
- o cookie de sessão funciona igual nos dois;
- não é preciso configurar CORS.

## Modelo de dados

```
congregations ─┬─ memberships (user, role: publisher|admin, status: active|revoked)
               ├─ access_codes (HMAC, validade, uso único, cancelamento)
               └─ territories ── blocks (número, link, lat/lng)
                                   └─ addresses (kind: house|building)
                                         ├─ units (tower, identifier)        ← só prédios
                                         └─ visit_records (contact|letter|absent, data, autor, nota, anulação)
users ── sessions / email_tokens / consents
audit_log (ator, flag de Administrador Geral, ação, entidade)
```

- **Isolamento por construção:** todas as tabelas de dados carregam `congregation_id`. As chaves estrangeiras são compostas (`(block_id, congregation_id) → blocks(id, congregation_id)`), então o banco rejeita qualquer vínculo entre registros de congregações diferentes. Além disso, toda consulta filtra por `congregation_id`.
- **Situação calculada, nunca gravada:** a *view* `target_status` calcula, para cada casa e cada apartamento:
  - `contacted`, se existe algum contato não anulado;
  - senão `letter`, se existe alguma carta;
  - senão `pending`.

  Também devolve as datas do último contato, da última carta e da última ausência. Assim, uma carta posterior nunca apaga um contato, e a data da carta nunca se confunde com a data do contato.
- **Trigger** impede registro de casa com apartamento, de prédio sem apartamento e de apartamento de outro prédio.
- **Sem ciclos automáticos:** nada "reinicia" um território sozinho. Um reinício futuro precisa de uma regra explícita.

## Autorização

- `requireAccess(congregação, perfil mínimo)` consulta o banco **a cada requisição**: vínculo ativo + perfil.
- Para quem não é membro, a resposta é **404**: o sistema não revela a existência de outras congregações.
- O Administrador Geral é um campo `users.is_global_admin`, alterado apenas pelo script `bootstrap-global-admin`. Nenhum parâmetro, cabeçalho ou metadado vindo do cliente é considerado.
- Toda ação feita por meio do perfil geral fica gravada com `actor_global = true`.
- **Revogação:**
  1. marca o vínculo como `revoked`;
  2. apaga todas as sessões do usuário;
  3. a partir da requisição seguinte, até uma sessão que tenha escapado deixa de acessar a congregação, porque o vínculo é conferido sempre.

## Segurança

| Tema | Implementação |
|---|---|
| Senhas | Argon2id; mesma resposta e tempo semelhante para "usuário não existe" e "senha errada" |
| Sessão | Token de 256 bits; no banco só o SHA-256; cookie `__Host-`, HttpOnly, Secure, SameSite=Lax; expira após 30 dias sem uso |
| CSRF | Toda requisição que altera dados exige `Origin` igual a `APP_ORIGIN`, além do SameSite |
| Links de e-mail | Token de uso único no *fragmento* da URL (`#t=`): não aparece em logs de servidor nem no Referer. Validade: 24 h (confirmação), 1 h (senha), 72 h (ativação) |
| Códigos de acesso | 12 caracteres de um alfabeto sem ambiguidade (~58 bits), `crypto.randomInt`, HMAC com segredo do servidor, `UPDATE … WHERE used_at IS NULL RETURNING` atômico, limite de 5 tentativas por 15 min por usuário e de 60 por IP |
| Limites | Contadores no PostgreSQL (valem após reinício): cadastro, login, recuperação, código, resolução de links |
| Cabeçalhos | CSP restritiva (`script-src 'self'`), HSTS, `frame-ancestors 'none'`, `nosniff` |
| Entradas | Zod em todas as rotas; limites de tamanho; observações bloqueiam padrões de telefone, e-mail e CPF |
| Logs | Só método e rota (sem query string); cookies, senhas, tokens e códigos são omitidos |
| SSRF (links do Maps) | Só HTTPS; lista fixa de domínios do Google; no máximo 4 redirecionamentos; o IP é conferido **na conexão** (bloqueia rede interna e DNS rebinding); timeout de 6 s; o corpo da resposta não é lido |
| Container | Usuário sem privilégios, sistema de arquivos só leitura, `cap_drop: ALL`, `no-new-privileges` |

## Por que não Google Sheets como banco

Planilhas não oferecem:

- transações nem consumo atômico de códigos;
- chaves estrangeiras;
- autorização por linha.

Também têm limites de cota. Uma exportação para planilha pode ser um recurso futuro, sempre gerada a partir do PostgreSQL.

## Por que TWA no Android

Ver [android-google-play.md](android-google-play.md#por-que-twa).
