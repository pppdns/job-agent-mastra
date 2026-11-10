# syntax=docker/dockerfile:1
# Production image for Fly.io: the Mastra agent (with Studio) and the Next.js web app in one
# container, sharing the database on the /data volume. See docs/deploy.md.
FROM node:24-bookworm-slim

ENV CI=true \
    NEXT_TELEMETRY_DISABLED=1
# Same pnpm as package.json's packageManager, installed directly (corepack would need that field).
RUN npm install -g pnpm@12.14.0

# The whole workspace stays in place: findWorkspaceRoot() looks for pnpm-workspace.yaml and
# migrations load from packages/db/drizzle at runtime.
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile

# Sentry (docs/deploy.md#sentry): the DSN comes from fly.toml [build.args] and is inlined into the
# browser bundle; the release (commit SHA) from the deploy workflow. Declared after the install
# layer so a new release doesn't reinstall dependencies.
ARG SENTRY_DSN=""
ARG SENTRY_RELEASE=""
ENV SENTRY_DSN=$SENTRY_DSN \
    NEXT_PUBLIC_SENTRY_DSN=$SENTRY_DSN \
    SENTRY_RELEASE=$SENTRY_RELEASE

# pnpm 12 lockfiles start with an extra YAML document (the pinned pnpm itself), which Mastra 1.81's
# bundler parses as a single document and fails on. In the image only: drop `packageManager`, so
# pnpm stops writing that document, and trim it from the lockfile before bundling.
# The optional SENTRY_AUTH_TOKEN build secret uploads the web app's source maps; it never lands in
# an image layer.
RUN --mount=type=secret,id=SENTRY_AUTH_TOKEN,required=false \
    node -e 'const f="package.json",p=JSON.parse(require("fs").readFileSync(f));delete p.packageManager;require("fs").writeFileSync(f,JSON.stringify(p,null,2))' \
    && awk '/^---$/ { n++ } n >= 2' pnpm-lock.yaml > /tmp/lock.yaml && mv /tmp/lock.yaml pnpm-lock.yaml \
    && (cd apps/agent && node_modules/.bin/mastra build --studio) \
    && (cd apps/web && SENTRY_AUTH_TOKEN="$(cat /run/secrets/SENTRY_AUTH_TOKEN 2>/dev/null || true)" node_modules/.bin/next build)

ENV NODE_ENV=production \
    DATABASE_URL=file:/data/copilot.db \
    AGENT_PORT=4111 \
    WEB_PORT=3000
EXPOSE 3000
CMD ["scripts/start-prod.sh"]
