# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY apps ./apps
COPY scripts ./scripts
COPY plugins ./plugins
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ARG CODEX_VERSION=0.155.0-alpha.9.2
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global "@openai/codex@${CODEX_VERSION}" \
    && npm cache clean --force
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/server ./apps/server
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist
COPY --from=build --chown=node:node /app/scripts ./scripts
RUN mkdir -p /data && chown node:node /data
USER node
ENV NODE_ENV=production \
    CODEX_POOL_HOST=0.0.0.0 \
    CODEX_POOL_PORT=4317 \
    CODEX_POOL_DATABASE_URL=/data/codex-pool.sqlite \
    CODEX_POOL_AUTH_DATABASE_URL=/data/codex-pool-auth.sqlite \
    CODEX_POOL_CODEX_COMMAND=codex
EXPOSE 4317
VOLUME ["/data"]
HEALTHCHECK --interval=20s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4317/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/server/src/server.mjs"]
