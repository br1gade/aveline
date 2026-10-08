# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────
# Aveline API
#
# Three stages so the runtime image carries neither the toolchain nor the
# dev dependencies: a smaller image is faster to deploy and has less in it
# that can be vulnerable.
# ─────────────────────────────────────────────────────────────────────────

ARG NODE_VERSION=26-alpine

# ── deps: every dependency, needed to build ──────────────────────────────
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

# Copied before the source so a source change does not reinstall everything.
COPY package.json package-lock.json ./
# Prisma's postinstall generates the client, which needs the schema present.
COPY prisma ./prisma
RUN npm ci

# ── build: compile TypeScript ────────────────────────────────────────────
FROM node:${NODE_VERSION} AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Fails the build rather than shipping an image that cannot start. The entry
# point went missing once already, when stale incremental build state was
# copied in from the host and tsc emitted almost nothing — and the image
# looked fine until something tried to run it.
RUN test -f dist/main.js || (echo 'build produced no dist/main.js' && ls -R dist | head -40 && exit 1)

# ── runtime: production dependencies and the compiled output ─────────────
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

ENV NODE_ENV=production

# tini reaps zombies and, more importantly here, forwards SIGTERM to node.
# Without an init, node runs as PID 1 and ignores the default signal
# handlers — so a deploy would wait out the stop timeout and kill the process
# before Nest's shutdown hooks could close the Postgres, Redis and Mongo
# connections.
RUN apk add --no-cache tini

COPY package.json package-lock.json ./
COPY prisma ./prisma
# `npm ci --omit=dev` still runs Prisma's postinstall, so the client is
# generated here against the same schema that will be migrated.
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY scripts ./scripts

# node's own unprivileged user, so a container escape is not already root.
USER node

EXPOSE 3000

# Checked by the orchestrator, not by the app: readiness covers the
# dependencies, and only Postgres is required — see health.controller.ts.
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
