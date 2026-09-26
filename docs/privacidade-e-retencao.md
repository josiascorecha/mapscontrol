# Privacidade, retenção e pontos para revisão jurídica

## Dados tratados
Somente dos **usuários** (publicadores e administradores): nome, e-mail, senha (hash), vínculo e perfil na congregação, registros de visita de sua autoria, aceite de termos (versão + data), auditoria. **Nenhum dado de moradores** é solicitado; as observações bloqueiam telefone, e-mail e CPF e a interface orienta a não registrar nomes ou crenças.

## Dado sensível
O vínculo a uma congregação pode revelar convicção religiosa (LGPD art. 5º, II). Base adotada: **consentimento específico e destacado** (art. 11, I), coletado no cadastro com versão e data registradas; um aceite genérico não resolve todas as obrigações — por isso esta seção existe.

## Retenção
| Dado | Prazo | Mecanismo |
|---|---|---|
| Conta | Enquanto ativa | Exclusão pelo usuário (app/web) anonimiza na hora |
| Registros de visita | Enquanto o território existir | Excluir território/quadra/endereço apaga em cascata (somente administrador) |
| Sessões | 30 dias sem uso | Limpeza automática a cada hora |
| Links de e-mail | 1–72 h; apagados 7 dias após expirar | Limpeza automática |
| Contadores de tentativas (IP em hash) | 2 dias | Limpeza automática |
| Auditoria | 730 dias (`AUDIT_RETENTION_DAYS`) | Limpeza automática |
| Backups | 30 dias (`BACKUP_KEEP_DAYS`) | Rotação no container de backup |

## Prestadores
Hospedagem (VPS), envio de e-mail (SMTP escolhido) e OpenStreetMap (tiles do mapa, recebe o IP). Liste nomes e países na versão final da política.

## Para decidir com assessoria jurídica antes do lançamento
1. Quem é o **controlador** (responsável pelo serviço, cada congregação, ou ambos) e quem é **operador**; identificação e canal do encarregado (DPO) ou justificativa de dispensa.
2. Texto final dos termos e da política (as versões do app estão marcadas como preliminares).
3. Se usuários menores de idade podem se cadastrar (exigiria consentimento dos responsáveis — LGPD art. 14).
4. Transferência internacional, se o SMTP ou a hospedagem estiverem fora do Brasil.
5. Procedimento para pedidos de titulares (prazo de resposta, registro).
6. Registro das operações de tratamento (art. 37) e relatório de impacto, se aplicável.

Ao mudar os textos, atualize `TERMS_VERSION`/`PRIVACY_VERSION` no `.env`: todos os usuários precisarão aceitar a nova versão no próximo acesso.
