# Seção "Segurança dos dados" (Play Console) — respostas sugeridas

> Revise com o texto final da política de privacidade antes de enviar. Se o funcionamento do app mudar, atualize as respostas.

## Visão geral

| Pergunta | Resposta |
|---|---|
| O app coleta ou compartilha algum dos tipos de dados obrigatórios? | **Sim** |
| Todos os dados coletados são criptografados em trânsito? | **Sim** (HTTPS obrigatório, HSTS) |
| Você oferece uma forma de os usuários pedirem a exclusão dos dados? | **Sim**, no app (Conta › Excluir minha conta) e na web (`/excluir-conta`) |
| Compartilhamento com terceiros | **Não**. Hospedagem e envio de e-mail são prestadores que agem em nome do app, o que não conta como "compartilhamento" segundo as definições do Google |

## Tipos de dados

| Categoria › tipo | Coletado | Compartilhado | Obrigatório? | Finalidades |
|---|---|---|---|---|
| Informações pessoais › **Nome** | Sim | Não | Obrigatório | Funcionalidade do app; gerenciamento da conta |
| Informações pessoais › **Endereço de e-mail** | Sim | Não | Obrigatório | Gerenciamento da conta (login, confirmação, recuperação) |
| Informações pessoais › **Crenças religiosas ou políticas** | Sim* | Não | Obrigatório | Funcionalidade do app |
| Atividade no app › **Outro conteúdo gerado pelo usuário** (registros de visita e observações) | Sim | Não | Obrigatório | Funcionalidade do app |
| Atividade no app › **Interações no app** (registro de auditoria) | Sim | Não | Obrigatório | Segurança, prevenção de fraude, conformidade |

\* O vínculo a uma congregação pode indicar convicção religiosa. Declarar esse item é a opção mais transparente. Confirme com a revisão jurídica.

**Não coletados:**

- localização (aproximada ou precisa);
- contatos, fotos, áudio e arquivos;
- identificadores do dispositivo e de publicidade;
- dados financeiros e de saúde;
- dados de diagnóstico e falhas: o app não tem SDKs de análise. Os logs do servidor não guardam conteúdo pessoal.

**Tratamento:**

- Os dados são processados de forma efêmera? Não: ficam armazenados enquanto a conta existir.
- Os mapas do OpenStreetMap são carregados diretamente pelo navegador e recebem o IP do aparelho. Informe isso na política de privacidade (já consta).
