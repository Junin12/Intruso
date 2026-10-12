FROM node:22-alpine
WORKDIR /app
COPY server.js words.js package.json ./
COPY public ./public
ENV NODE_ENV=production
# O Cloud Run define PORT (8080); o servidor já lê essa variável.
USER node
CMD ["node", "server.js"]
