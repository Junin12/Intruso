# Do código à Play Store: passo a passo

O que já está pronto neste pacote: o jogo com anúncios e compras, o projeto Android (`android/`), a política de privacidade (`public/privacidade.html`), os textos e imagens da ficha (`play-store/`).
O que **só você pode fazer**: criar as contas, hospedar o servidor, gerar sua chave de assinatura e enviar o app. Este pacote **não foi compilado**: o ambiente onde foi criado não tinha o Android SDK. Compile e teste num celular antes de publicar.

## 1. Hospedar o servidor (obrigatório)
O app é uma "moldura" que abre o jogo hospedado; sem servidor público ele não funciona.
1. Publique este repositório no Render (Web Service, Node, `node server.js`).
2. Use um plano que **não durma** (o grátis dorme e a primeira partida demora ~1 min para abrir). Uma única instância, porque as salas ficam em memória.
3. Anote o endereço, por exemplo `https://intruso.onrender.com/`. Abra `/privacidade.html` nele e confira.
4. Edite em `privacidade.html` o nome e o e-mail de contato (campos entre colchetes) e publique de novo.

## 2. Contas
- **Google Play Console** (taxa única de US$ 25): https://play.google.com/console
- **AdMob** (grátis): https://admob.google.com. Crie o app, depois um bloco **Intersticial** e um **Premiado**. Anote o App ID e os dois IDs de bloco.
  Conta nova no Play pode exigir um período de teste fechado com testadores antes da produção. Confira as regras atuais no Console.

## 3. Configurar o projeto Android
Em `android/gradle.properties` troque:
- `GAME_URL` pelo endereço do passo 1 (https e com `/` no final);
- `ADMOB_APP_ID`, `INTERSTITIAL_ID`, `REWARDED_ID` pelos seus. **Enquanto usar os IDs de teste, não clique nos seus próprios anúncios reais** (risco de banimento).
- O pacote do app é `br.com.intruso.jogo`. Se quiser outro, mude em `app/build.gradle.kts` (`namespace` e `applicationId`) e na pasta `java/`.

## 4. Gerar a chave e o .aab (Android Studio)
1. Instale o Android Studio e abra a pasta `android/` (ele baixa o Gradle e o SDK).
2. Teste: conecte um celular (ou emulador) e rode `app`. Confira: o jogo abre, o som funciona, aparece "Apoie o jogo" no perfil, anúncios de teste aparecem depois de 2 partidas.
3. **Build > Generate Signed App Bundle > Android App Bundle**. Crie uma chave nova (guarde o `.jks` e as senhas em lugar seguro, fora do Git). Alternativa: copie `keystore.properties.example` para `keystore.properties` e rode `./gradlew bundleRelease`.
4. O arquivo sai em `app/build/outputs/bundle/release/app-release.aab`.
5. Ative o **Play App Signing** (padrão) ao enviar.

## 5. Produtos de compra (Play Console > Monetizar > Produtos > Produtos no app)
Crie dois **produtos únicos** com exatamente estes IDs:
| ID | Nome | Preço sugerido |
|---|---|---|
| `remove_ads` | Remover anúncios | R$ 9,90 |
| `avatar_pack` | Pacote de personagens | R$ 6,90 |
As compras só funcionam em app enviado ao Play (teste interno serve) e com contas de teste de licença configuradas.

## 6. Ficha da loja
- Textos: `TEXTOS-DA-LOJA.md`. Ícone: `graficos/icone-512.png`. Gráfico: `graficos/grafico-recursos-1024x500.png`. Capturas: pasta `capturas/` (tiradas no computador com fonte reserva; refaça no celular com a fonte real se quiser).
- **Política de privacidade (URL):** `https://SEU-SERVIDOR/privacidade.html`.
- **Segurança dos dados (Data safety):** declare coleta de: nome de usuário (visível a outros jogadores, funcionalidade do app), identificadores de dispositivo ou outros (AdMob, publicidade), compras. Dados em trânsito criptografados. Marque que o app contém **anúncios** e **compras no app**.
- **Público-alvo:** 13 anos ou mais (não marque "crianças"; isso exigiria regras bem mais rígidas de anúncios).
- **Classificação de conteúdo:** responda o questionário (chat entre usuários: sim).

## 7. Antes de ir para produção
- **Consentimento de anúncios (Europa/Reino Unido):** se o app for distribuído lá, implemente a mensagem de consentimento (Google UMP / AdMob "Privacidade e mensagens"). Para só o Brasil, confira a necessidade no AdMob.
- Teste com 2+ celulares em salas reais, inclusive rede móvel (SSE passa por alguns proxies com atraso).
- Comece pelo **teste interno**, depois fechado/aberto, e só então produção.

## Limites desta versão (conhecidos)
- O login do Google (Firebase) está **desligado no app**, porque o Google bloqueia login dentro de WebView. Para ter conta no app seria preciso o login nativo (Credential Manager). O perfil fica no aparelho.
- As compras são conferidas só no aparelho (sem validação no servidor). Aceitável para compra de baixo valor e personagens, mas quem tem celular com root pode forjar. Para blindar, valide o token da compra no servidor com a API do Google Play.
- O XP e o perfil são locais, então o ranking global (quando existir) pode ser forjado (ver README).
- Os valores de versões (AGP, Kotlin, AdMob, Billing) e o `targetSdk` mudam com o tempo; o Android Studio avisa quando houver atualização obrigatória.
