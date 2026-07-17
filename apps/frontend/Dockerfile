# Build a partir da RAIZ do monorepo:
#   docker build -f apps/frontend/Dockerfile .
FROM node:22-slim AS build

RUN npm install -g pnpm@11
WORKDIR /app

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

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
  pnpm config set store-dir /root/.local/share/pnpm/store \
  && pnpm install --frozen-lockfile --filter transynex --filter "@transynex/frontend..."

COPY apps/frontend/ apps/frontend/
RUN pnpm --filter @transynex/frontend build

FROM nginx:1.27-alpine
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html
EXPOSE 80
