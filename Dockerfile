# Imagem da API do Orari.
#
# Mantém as dependências de desenvolvimento de propósito: o `prisma` (migrações) e o
# `ts-node` (seed) estão nelas e rodam dentro do contêiner. Em troca, a imagem é
# maior; para a escala atual, a simplicidade vale mais.
FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates wget \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Primeiro só o que o `npm ci` precisa (o postinstall roda `prisma generate`):
# enquanto isso não muda, a camada das dependências é reaproveitada.
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

COPY . .

# O cliente do Prisma é gerado de novo agora, com o tsconfig.json já presente: o
# Prisma decide a extensão dos imports (.js ou .ts) olhando esse arquivo, e na
# geração do `npm ci` ele ainda não estava na imagem (o build saía com imports .ts
# e a API não subia).
RUN npx prisma generate && npm run build

# Só depois do build: NODE_ENV=production antes disso faria o npm pular as
# dependências de desenvolvimento.
ENV NODE_ENV=production \
    PORT=3333 \
    UPLOADS_DIR=/data/uploads

# Pasta das fotos e logos, montada como volume (sobrevive a novos deploys).
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node

EXPOSE 3333

# As migrações rodam a cada subida (`migrate deploy` só aplica as que faltam).
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main"]
