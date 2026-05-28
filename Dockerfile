# syntax=docker/dockerfile:1.7

# ─── Build stage ────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /src

# Copy lockfile + workspace metadata first for better layer caching.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/viewer/package.json packages/viewer/
COPY examples/sample-wiki/package.json examples/sample-wiki/

# Install deps with native modules built against this container's libc.
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile=false

# Now copy source + build both packages.
COPY . .
RUN pnpm --filter @useremember/core build
RUN pnpm --filter @useremember/viewer build

# ─── Runtime stage ──────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV REMEMBER_HOST=0.0.0.0
ENV REMEMBER_API_PORT=4320
ENV REMEMBER_PORT=4321

# Curl is used by the healthcheck; the rest of the dep chain is in node_modules.
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Copy the monorepo with its built artifacts and installed deps.
COPY --from=build /src /app

# /wiki is the user's data dir — mount a volume here.
RUN mkdir -p /wiki && \
    ln -s /app/packages/core/bin/remember.js /usr/local/bin/remember && \
    chmod +x /app/packages/core/bin/remember.js

WORKDIR /wiki

EXPOSE 4320 4321

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4320/v1/health || exit 1

# Default entrypoint = the CLI. CMD = `start` (production mode).
ENTRYPOINT ["node", "/app/packages/core/bin/remember.js"]
CMD ["start"]
