ARG CLC_RUNTIME_SOURCE=npm
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY client ./client
COPY scripts ./scripts
COPY test ./test
COPY demo ./demo
RUN npm test && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime-base
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
FROM runtime-base AS runtime-npm
# Pin the same runtime that passed the protocol and tool probe; never install latest.
ARG TARGETARCH
RUN case "$TARGETARCH" in amd64) codex_arch=x64;; arm64) codex_arch=arm64;; *) exit 1;; esac \
    && npm install -g --omit=optional --no-audit --no-fund --fetch-retries=0 --fetch-timeout=120000 \
      @openai/codex@0.155.1 "@openai/codex-linux-${codex_arch}@npm:@openai/codex@0.155.1-linux-${codex_arch}"
FROM runtime-base AS runtime-local
# Optional offline build input, prepared by run.sh. Only a verified ELF executable.
COPY .runtime/codex /usr/local/bin/codex
RUN codex --version | grep -Fx 'codex-cli 0.155.1'

FROM runtime-${CLC_RUNTIME_SOURCE} AS companion
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY demo ./demo
RUN mkdir /state && chown node:node /state
USER node
ENV CLC_STATE=/state
ENTRYPOINT ["node", "dist/src/cli.js"]
CMD ["start"]
