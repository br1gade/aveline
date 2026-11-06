# The client's production image (decision A7 stays open: this says nothing about where it runs).
# Built from this folder: `docker build -t aveline-frontend .` Not built by anyone yet: see
# docs/ARCHITECTURE.md §12.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
# Compiled into the browser bundle, so they are build arguments, and never secrets.
ARG VITE_PUBLIC_ORIGIN
ARG VITE_API_BASE_URL=""
ARG VITE_MEDIA_BASE_URL=""
# How customers reach Aveline, and its website (design C-54, C-35): each optional, set for production.
ARG VITE_SUPPORT_EMAIL=""
ARG VITE_SUPPORT_PHONE=""
ARG VITE_SUPPORT_WHATSAPP=""
ARG VITE_SUPPORT_TELEGRAM=""
ARG VITE_SITE_URL=""
RUN test -n "$VITE_PUBLIC_ORIGIN" && npm run build

FROM node:24-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev

FROM node:24-slim
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
COPY package.json ./
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY server/index.ts server/serve.ts server/handler.ts server/settings.ts server/log.ts server/static.ts ./server/
COPY src/lib/capability-links/redact.ts ./src/lib/capability-links/redact.ts
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "server/index.ts"]
