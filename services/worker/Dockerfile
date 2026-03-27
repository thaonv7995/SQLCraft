# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
RUN apk add --no-cache docker-cli
RUN npm install -g pnpm@9
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/types/package.json ./packages/types/
COPY packages/config/package.json ./packages/config/
COPY services/worker/package.json ./services/worker/
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages ./packages
COPY services/worker ./services/worker
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @sqlcraft/types build
RUN pnpm --filter @sqlcraft/worker build

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/.npmrc ./
COPY --from=build /app/packages ./packages
COPY --from=build /app/services/worker ./services/worker
COPY --from=build /app/node_modules ./node_modules
WORKDIR /app/services/worker
CMD ["node", "dist/index.js"]
