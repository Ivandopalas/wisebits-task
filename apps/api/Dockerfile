# Build context: repository root (the API depends on packages/shared).

FROM node:24-alpine AS base
# Build-time only: Docker networks often have no IPv6 route while the registry resolves to
# IPv6 too, and Node then stalls on those addresses instead of falling back to IPv4.
ENV NODE_OPTIONS="--no-network-family-autoselection --dns-result-order=ipv4first"
RUN npm install -g pnpm@10.20.0
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @chat/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @chat/shared build \
  && pnpm --filter @chat/api build \
  && pnpm --filter @chat/api deploy --prod --legacy /out
# @nestjs/swagger lists TypeScript as an optional peer for its compiler plugin, so pnpm links
# the workspace's copy into the deployment. Nothing loads it at runtime: 24 MB less.
RUN rm -rf /out/node_modules/.pnpm/typescript@* \
  && find /out/node_modules -name typescript -type l -delete

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "dist/main.js"]
