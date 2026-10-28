# Build context: repository root (the web app depends on packages/shared).

FROM node:24-alpine AS base
# Build-time only: Docker networks often have no IPv6 route while the registry resolves to
# IPv6 too, and Node then stalls on those addresses instead of falling back to IPv4.
ENV NODE_OPTIONS="--no-network-family-autoselection --dns-result-order=ipv4first"
RUN npm install -g pnpm@10.20.0
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @chat/web...
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @chat/shared build \
  && pnpm --filter @chat/web build \
  && pnpm --filter @chat/web deploy --prod --legacy /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "build"]
