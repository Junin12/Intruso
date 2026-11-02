# Intruso — protótipo web

Jogo de festa multijogador: cada pessoa entra pelo próprio celular, todos recebem a mesma palavra secreta, menos o intruso.

> **Mudança (nov/2026):** o jogo web agora roda dentro da **Vila Sossego** (repositório `Junin12/vila-sossego`, em `/intruso/`),
> no mesmo servidor do Cara de Pau e do Ninguém Dorme, e soma no Passaporte da Vila. Mudanças no jogo web são feitas lá.
> Este repositório guarda o app Android (`android/`, que abre https://vila-sossego.onrender.com/intruso/) e a loja (`play-store/`).
> No Render, o serviço antigo (`intruso-eaza.onrender.com`) roda com `MUDOU_PARA` e só redireciona para o endereço novo.

## Rodar
    node server.js          # precisa de Node 18+; não há dependências para instalar
    # abra http://localhost:3000

Para jogar com amigos no mesmo Wi-Fi, abra `http://IP-DO-SEU-PC:3000` nos celulares.
Para jogar pela internet, publique a pasta em qualquer host de Node (Render, Railway, Fly.io):
comando de start `node server.js`; a porta vem da variável `PORT`.

## Estrutura
- `server.js`  — salas, regras, tempo real (HTTP + Server-Sent Events)
- `words.js`   — palavras por categoria (edite à vontade; 150 por categoria)
- `pairs.js`   — pares do modo palavra parecida
- `public/index.html` — interface (HTML/CSS/JS em um arquivo; os personagens são SVGs desenhados no próprio arquivo)

## Regras
1. Mínimo 3, máximo 10 jogadores. Cada um escolhe um dos 12 personagens (únicos na sala; dá para trocar no lobby). O anfitrião escolhe a categoria e inicia.
2. No início de cada rodada todos veem o placar por 6 segundos (o anfitrião pode pular). Mude o tempo com a variável `INTRO_MS`.
3. Todos veem a palavra; o intruso só vê a categoria.
4. 2 voltas de dicas (uma palavra por vez), depois chat e votação.
5. Intruso pego tem uma chance de adivinhar a palavra.
6. Pontos: tripulação +1 cada se vencer; intruso +2 se vencer. Se o intruso escapar da votação, quem votou nele mesmo assim ganha +1.
7. Modo **palavra parecida** (ajuste do lobby): o intruso recebe uma palavra próxima da turma (pares em `pairs.js`) e se vê como tripulante até ser descoberto.
8. **Cúmplice** (ajuste do lobby, 6+ jogadores): sabe a palavra e quem é o intruso; ganha +2 junto com o intruso e não leva o +1 do voto certo.
9. Categoria **Personalizada**: o anfitrião digita de 6 a 60 palavras; só ele vê a lista.
10. **Jogar em 1 celular** (tela inicial): a partida roda toda no aparelho (`public/local.js`), passando de mão em mão; dicas e votação em voz alta.

## Limites conhecidos do protótipo
Salas ficam na memória (reiniciar o servidor apaga tudo; uma instância só).

## Publicar (GitHub + Render)
O GitHub Pages só serve páginas estáticas, e o Intruso precisa de um servidor Node. O caminho mais simples:
1. Suba este repositório no GitHub (comandos abaixo).
2. Em render.com, entre com a conta do GitHub, escolha **New > Blueprint** e selecione o repositório. O `render.yaml` já configura tudo.
3. O Render gera uma URL pública; abra no celular e compartilhe o link da sala.

Obs.: no plano gratuito o servidor "dorme" após alguns minutos sem uso e a primeira abertura demora; as salas ficam na memória.

## Enviar para o GitHub
    git init -b main
    git add .
    git commit -m "Intruso: protótipo web"
    git remote add origin https://github.com/SEU-USUARIO/intruso.git
    git push -u origin main


## Novidades (v2)

- 11 categorias com 100+ palavras cada (inclui Futebol, Novelas e TV, Comidas regionais, Marcas, Internet e memes); a palavra não repete dentro da sala.
- O anfitrião escolhe partidas de 5, 10 ou 20 rodadas e os tempos de dica e votação (no lobby e entre as rodadas). Fim de partida com pódio e prêmios.
- 2 intrusos com 7 ou mais jogadores (a sala precisa pegar os dois).
- Entrada no meio da partida: a pessoa assiste e joga a partir da próxima rodada.
- Revelação dos votos com suspense, sons e vibração; reações com emoji na votação.
- Perfil local (nível, XP, títulos, conquistas, 8 personagens exclusivos, desafio diário). Fica no aparelho: é diversão, não segurança.
- Compartilhar: WhatsApp, imagem do resultado e QR code da sala.

Testes: `npm test` (palavras, perfil, regras do servidor). Extras: `python3 test/qr_check.py` (QR lido pelo OpenCV) e `python3 test/ui_test.py` (partida completa no Chromium com Playwright).
Variável de teste: `SEC_MS` escala a duração de 1 segundo do jogo.

## Contas, perfil na nuvem e ranking global (Firebase)

Opcional: sem configuração o jogo funciona igual, com o perfil só no aparelho.

1. No [Console do Firebase](https://console.firebase.google.com) crie um projeto (plano Spark, grátis).
2. **Authentication > Método de login**: ative **Google**. Em **Configurações > Domínios autorizados** adicione o domínio do seu site (ex.: `seu-jogo.onrender.com`).
3. **Firestore Database**: crie o banco e, em **Regras**, cole o conteúdo de `firestore.rules` e publique.
4. **Configurações do projeto > Seus apps > Web (`</>`)**: copie a configuração para `public/firebase-config.js` (`window.FIREBASE_CONFIG = {...}`).
5. Publique de novo. Aparecem "Entrar com Google" e "Ranking global".

Como funciona: ao entrar, o perfil da nuvem é mesclado com o do aparelho (maior valor de cada contador, conquistas somadas) e salvo a cada rodada. `users/{uid}` guarda o perfil completo (só o dono acessa) e `board/{uid}` o resumo público do ranking.

Limite conhecido: o cliente grava o próprio XP, então um usuário técnico pode forjar valores (as regras só limitam formato e tamanho). Para um ranking à prova de trapaça, o servidor teria de calcular o XP e gravar com credenciais de administrador.
Teste da integração com Firebase simulado: `python3 test/cloud_test.py`.


## App Android e monetização

Há um projeto Android pronto em `android/` (WebView + AdMob + Google Play Billing) e o material da loja em `play-store/`. Passo a passo: `play-store/PUBLICAR.md`. Monetização: anúncio entre partidas (a cada 2, com intervalo mínimo), anúncio premiado (+30 XP, 3 por dia) e compras únicas (`remove_ads`, `avatar_pack`). Teste da lógica com ponte falsa: `python3 test/monet_test.py`. O projeto Android não foi compilado no ambiente de criação.
