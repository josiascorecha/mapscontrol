# Android e Google Play

## Por que TWA

| Opção | Prós | Contras | Decisão |
|---|---|---|---|
| **TWA** (Trusted Web Activity) | Mesmo código e backend da web; atualiza sem publicar nova versão; APK pequeno; o Chrome cuida da segurança, dos cookies e das atualizações | Precisa de Chrome (ou navegador compatível) no aparelho; depende do Digital Asset Links | **Escolhida** |
| Capacitor | Acesso a recursos nativos; WebView embutida | Segundo alvo de build para manter; os cookies ficam na WebView e se separam do navegador; exige republicar a cada mudança de interface | Só compensaria com recursos nativos (offline real, câmera etc.) |
| Nativo (Kotlin) | Melhor desempenho | Reescrever toda a interface | Desproporcional |

O MapsControl não usa recursos nativos. Por isso a TWA entrega a mesma experiência com o menor custo de manutenção. **Um empacotamento simples do site não garante aprovação:** o app precisa funcionar bem como aplicativo, e o PWA já oferece isso:

- manifesto, ícones e tela cheia;
- página "sem conexão";
- navegação inferior;
- exclusão de conta dentro do app.

## Projeto (`android/`)

- Biblioteca `com.google.androidbrowserhelper:androidbrowserhelper:2.7.3`.
- `applicationId` padrão: `br.com.j2bot.mapscontrol`. **Confirme antes da primeira publicação:** ele não pode mudar depois.
- `compileSdk`/`targetSdk` 36 e `minSdk` 23. AGP 8.13.0 com Gradle 8.14.3 (wrapper incluído) e JDK 17.
- Host, versão e identificador ficam em `android/gradle.properties`.
- Assinatura **somente por variáveis de ambiente** (`MC_KEYSTORE_PATH`, `MC_KEYSTORE_PASSWORD`, `MC_KEY_ALIAS`, `MC_KEY_PASSWORD`). Nenhuma chave vai para o repositório.
- Ícones adaptativos e splash já gerados.

> **Não compilado ainda.** O ambiente de desenvolvimento não tinha acesso ao Google Maven. Compile com o GitHub Actions ou com o Android Studio (abaixo) e corrija o que aparecer na primeira compilação.

## Gerar o Android App Bundle (AAB)

### Opção A — GitHub Actions (recomendado)

1. Gere a **chave de upload** no seu computador. Guarde o arquivo e as senhas num gerenciador de senhas, **fora** do repositório:
   ```bash
   keytool -genkeypair -v -keystore mapscontrol-upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000
   base64 -w0 mapscontrol-upload.jks > upload.b64
   ```
2. No GitHub, abra *Settings → Secrets and variables → Actions* e crie `ANDROID_UPLOAD_KEYSTORE_B64` (conteúdo do `upload.b64`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`upload`) e `ANDROID_KEY_PASSWORD`. Depois apague o `upload.b64`.
3. Em *Actions → Android (AAB) → Run workflow*, informe `versionCode` (1, 2, 3…) e `versionName`.
4. Baixe o artefato `.aab`.

### Opção B — Android Studio (Windows)

1. Abra a pasta `android/`.
2. Defina as variáveis `MC_*` no ambiente e rode `gradlew.bat bundleRelease`.
3. O arquivo sai em `android/app/build/outputs/bundle/release/`.

### Assinatura e guarda das chaves

- Use o **Play App Signing**: o Google guarda a chave de assinatura final e você guarda só a **chave de upload**. Se perder a chave de upload, dá para pedir a troca ao suporte do Play. Sem Play App Signing, perder a chave impede atualizar o app.
- Faça duas cópias da keystore, em lugares diferentes (ex.: gerenciador de senhas + pendrive guardado).
- Nunca envie a keystore por e-mail ou chat nem a deixe em pastas sincronizadas públicas.

## Digital Asset Links (obrigatório para abrir sem barra de endereço)

1. No Play Console, abra *Configuração → Integridade do app → Assinatura do app* e copie a **impressão digital SHA-256 da chave de assinatura do app**. Se for testar APKs assinados localmente, copie também a da chave de upload.
2. No `.env` da VPS:
   ```
   ANDROID_PACKAGE=br.com.j2bot.mapscontrol
   ANDROID_CERT_SHA256=AA:BB:…,CC:DD:…
   ```
3. Rode `bash scripts/deploy.sh` e confira `https://mapscontrol.SEU-DOMINIO/.well-known/assetlinks.json`.
4. Valide com a ferramenta *Statement List Generator and Tester* do Google.

Se a verificação falhar, o app abre com uma barra de endereço no topo. Esse é o sinal para conferir o passo 1.

## Requisitos atuais do Google Play (conferidos em 26/09/2026)

- **API alvo:** desde 31/08/2026, apps novos e atualizações precisam ter `targetSdk` 36 (Android 16) ou maior. O projeto já usa 36. [Fonte](https://developer.android.com/google/play/requirements/target-sdk)
- **Contas pessoais criadas após 13/11/2023:** exigem um **teste fechado com pelo menos 12 testadores inscritos continuamente por 14 dias** antes de pedir acesso à produção. [Fonte](https://support.google.com/googleplay/android-developer/answer/14151465)
- **Exclusão de conta:** precisa existir dentro do app e também por um link na web, informado no Play Console. Use `https://mapscontrol.SEU-DOMINIO/excluir-conta`.
- **Formulário de segurança dos dados:** veja [play-store/seguranca-dos-dados.md](play-store/seguranca-dos-dados.md).
- **Política de privacidade:** URL pública `https://mapscontrol.SEU-DOMINIO/privacidade`.
- Consulte de novo a documentação oficial no dia da submissão, porque as regras mudam. **Não há garantia de aprovação.**

As ações pessoais do titular são: verificação de identidade, pagamento da taxa e aceite dos contratos da conta de desenvolvedor.

## Plano de testes em aparelhos reais

Use pelo menos 3 aparelhos: um Android antigo (8 ou 9), um intermediário e um recente (14 a 16). Inclua telas pequenas (≤ 5,5").

| # | Cenário | Esperado |
|---|---|---|
| 1 | Instalar pelo teste interno e abrir | Splash azul-escuro e depois a tela Entrar, **sem barra de endereço** |
| 2 | Cadastro → link do e-mail aberto no celular | O link abre no app (ou no Chrome) e confirma a conta |
| 3 | Entrar com código | Entra na congregação |
| 4 | Território → mapa → tocar no marcador → Abrir endereços | Lista da quadra |
| 5 | "Abrir no Google Maps" | Abre o app Google Maps |
| 6 | Registrar carta e depois contato numa casa | Chip muda para "Com carta" e depois para "Contato realizado", com a data certa |
| 7 | Prédio: cadastro por andares, remover um apto na revisão, salvar | Número correto de apartamentos |
| 8 | Modo avião durante um registro | Mensagem "Sem conexão", dados preservados, nada marcado como salvo |
| 9 | Tema escuro do sistema | Interface escura legível |
| 10 | Revogar o publicador pelo painel do administrador | O app do publicador volta para Entrar na próxima ação |
| 11 | Girar a tela, fonte grande (acessibilidade 130%) | Sem cortes nem rolagem horizontal |
| 12 | Excluir conta pelo app | Sai e não consegue entrar de novo |
| 13 | Aparelho sem Chrome atualizado | Abre em Custom Tab (fallback) |

Registre modelo, versão do Android, data e resultado. Esse registro também serve como evidência do teste fechado.

## Materiais da loja

- [Ficha da loja](play-store/ficha-da-loja.md): textos.
- Ícone 512×512: `docs/play-store/icone-512.png`.
- Gráfico de destaque 1024×500: `docs/play-store/grafico-destaque-1024x500.png`.
- Capturas de tela: use `docs/screenshots/` como base e **recapture com dados fictícios no ambiente de produção**, já com o mapa carregado.
