# syntax=docker/dockerfile:1.7
# ChisaCode daemon 容器化模板。
# 仅构建 daemon 运行所需的 packages/server 及其依赖（highlight/relay/protocol/client）。
# app/desktop/cli 与本镜像无关，由 .dockerignore 排除以减少上下文体积。

FROM node:22-alpine AS deps

WORKDIR /app

# 先复制锁文件与清单，最大化 npm ci 缓存命中。
COPY package.json package-lock.json ./
COPY packages/highlight/package.json packages/highlight/
COPY packages/relay/package.json packages/relay/
COPY packages/protocol/package.json packages/protocol/
COPY packages/client/package.json packages/client/
COPY packages/server/package.json packages/server/
# 以下 package.json 仍需复制以保持 workspace 解析完整；其源码会被 .dockerignore 排除后续构建步骤。
COPY packages/app/package.json packages/app/
COPY packages/desktop/package.json packages/desktop/
COPY packages/cli/package.json packages/cli/
COPY packages/expo-two-way-audio/package.json packages/expo-two-way-audio/

RUN npm ci --omit=dev --no-audit --no-fund

FROM deps AS build

# devDependencies 在构建阶段必需（typescript / tsgo / 脚本工具）。
RUN npm ci --no-audit --no-fund

# 复制构建所需源码（.dockerignore 已排除无关包的源码）。
COPY packages/highlight packages/highlight
COPY packages/relay packages/relay
COPY packages/protocol packages/protocol
COPY packages/client packages/client
COPY packages/server packages/server

# 构建依赖链：highlight -> relay -> protocol -> client，然后 server（含 cli）。
RUN npm run build:server-deps && npm run build --workspace=@chisacode/server

# 运行阶段：仅保留 daemon 运行时所需的 node_modules 与 dist 产物。
FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    CHISACODE_HOME=/data \
    CHISACODE_LISTEN=0.0.0.0:6767

# node:22-alpine 自带 node 用户（uid 1000）。以非 root 运行。
RUN mkdir -p /data && chown -R node:node /app /data

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages/highlight/node_modules ./packages/highlight/node_modules
COPY --from=build --chown=node:node /app/packages/relay/node_modules ./packages/relay/node_modules
COPY --from=build --chown=node:node /app/packages/protocol/node_modules ./packages/protocol/node_modules
COPY --from=build --chown=node:node /app/packages/client/node_modules ./packages/client/node_modules
COPY --from=build --chown=node:node /app/packages/server/node_modules ./packages/server/node_modules
COPY --from=build --chown=node:node /app/packages/highlight/dist ./packages/highlight/dist
COPY --from=build --chown=node:node /app/packages/relay/dist ./packages/relay/dist
COPY --from=build --chown=node:node /app/packages/protocol/dist ./packages/protocol/dist
COPY --from=build --chown=node:node /app/packages/client/dist ./packages/client/dist
COPY --from=build --chown=node:node /app/packages/server/dist ./packages/server/dist
COPY --from=build --chown=node:node /app/packages/server/package.json ./packages/server/package.json
COPY --from=build --chown=node:node /app/package.json ./package.json

USER node

EXPOSE 6767

VOLUME ["/data"]

# Health probe: daemon exposes GET /api/health (unauthenticated).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:6767/api/health || exit 1

# 入口对应 packages/server package.json 的 `start` 脚本：supervisor-entrypoint.js
CMD ["node", "packages/server/dist/scripts/supervisor-entrypoint.js"]