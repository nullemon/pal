# Multi-stage image for the web app and the worker. Built from the repo root:
#   docker build -f infra/Dockerfile --target web -t palscans-web .
#   docker build -f infra/Dockerfile --target worker -t palscans-worker .
FROM node:22-alpine AS base
# `corepack enable` only shims pnpm — the real download happens on first use. Activating it
# here puts pnpm in the image, so no container start ever reaches the registry for it (a
# silent hang, then a restart loop, if egress is firewalled). Keep in step with
# `packageManager` in the root package.json.
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
# The page watermark (docs/03, Admin -> Appearance -> Watermark) is drawn as SVG text and
# composited by sharp, which resolves the face through fontconfig. node:22-alpine ships no
# fonts at all, and librsvg fails silently on a missing face -- it renders an empty layer,
# so every page would come out unmarked. The worker composites and the web app renders the
# admin preview with the same code, so both stages need this.
RUN apk add --no-cache fontconfig font-dejavu
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/core/package.json packages/core/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm turbo run build

FROM base AS web
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/web
EXPOSE 3000
CMD ["pnpm", "start"]

FROM base AS worker
ENV NODE_ENV=production
# The `db.backup` job (docs/18 §9, infra/RUNBOOK.md) shells out to pg_dump and pg_restore,
# which node:22-alpine does not ship — without this every backup fails with "pg_dump not
# found" and the panel says so. The client must be at least the server's major version;
# Alpine's default client is newer than the postgres:16 image in docker-compose.yml, which
# is the supported direction. Only the worker needs it: the web app never takes a dump.
RUN apk add --no-cache postgresql-client
COPY --from=build /repo /repo
WORKDIR /repo/apps/worker
CMD ["pnpm", "start"]
