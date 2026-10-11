# Intruso — protótipo web

Jogo de festa multijogador: cada pessoa entra pelo próprio celular, todos recebem a mesma palavra secreta, menos o intruso.

## Rodar
    node server.js          # precisa de Node 18+; não há dependências para instalar
    # abra http://localhost:3000

Para jogar com amigos no mesmo Wi-Fi, abra `http://IP-DO-SEU-PC:3000` nos celulares.
Para jogar pela internet, publique a pasta em qualquer host de Node (Render, Railway, Fly.io):
comando de start `node server.js`; a porta vem da variável `PORT`.

## Estrutura
- `server.js`  — salas, regras, tempo real (HTTP + Server-Sent Events)
- `words.js`   — palavras por categoria (edite à vontade)
- `public/index.html` — interface (HTML/CSS/JS em um arquivo)

## Regras
1. Mínimo 3, máximo 10 jogadores. O anfitrião escolhe a categoria e inicia.
2. Todos veem a palavra; o intruso só vê a categoria.
3. 2 rodadas de dicas (uma palavra por vez), depois chat e votação.
4. Intruso pego tem uma chance de adivinhar a palavra.
5. Pontos: tripulação +1 cada se vencer; intruso +2 se vencer.

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
