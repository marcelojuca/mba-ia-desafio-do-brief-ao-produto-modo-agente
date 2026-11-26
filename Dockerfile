FROM node:22-alpine

# Fuso fixo do produto (America/Sao_Paulo, −03:00).
RUN apk add --no-cache tzdata
ENV TZ=America/Sao_Paulo

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY scripts ./scripts
COPY test ./test

ENV NODE_ENV=production
EXPOSE 3000
USER node

CMD ["node", "src/main.js"]
