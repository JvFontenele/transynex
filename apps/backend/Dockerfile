# Build a partir da RAIZ do monorepo:
#   docker build -f apps/backend/Dockerfile .
# Os pacotes do workspace exportam TypeScript direto (main: src/index.ts),
# então não há etapa de build — o servidor roda via tsx.
FROM node:22-slim

# openssl: exigido pelos engines do Prisma em Debian slim.
# poppler-utils: fornece o pdftoppm, usado para rasterizar páginas de PDF.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates poppler-utils \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@11

WORKDIR /app

# Manifests primeiro para aproveitar cache de camada no install.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/cli/package.json apps/cli/
COPY apps/frontend/package.json apps/frontend/
COPY packages/core/package.json packages/core/
COPY packages/core-contracts/package.json packages/core-contracts/
COPY plugins/export-basic/package.json plugins/export-basic/
COPY plugins/ocr-tesseract/package.json plugins/ocr-tesseract/
COPY plugins/render-canvas/package.json plugins/render-canvas/
COPY plugins/storage-local/package.json plugins/storage-local/
COPY plugins/translation-libretranslate/package.json plugins/translation-libretranslate/
COPY plugins/translation-ollama/package.json plugins/translation-ollama/

# Instala só o backend, suas deps do workspace e a raiz (tsx/typescript).
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
  pnpm config set store-dir /root/.local/share/pnpm/store \
  && pnpm install --frozen-lockfile --filter transynex --filter "@transynex/backend..."

COPY packages/ packages/
COPY plugins/ plugins/
COPY apps/backend/ apps/backend/

RUN pnpm --filter @transynex/backend exec prisma generate

WORKDIR /app/apps/backend
ENV NODE_ENV=production
EXPOSE 3000

# migrate deploy toda subida: aplica migrations pendentes e é no-op quando
# o banco já está atualizado.
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx src/main.ts"]
