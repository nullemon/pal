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
# `next build` type-checks after it compiles, and tsc holds the whole program graph in memory.
# V8 derives its default old-space ceiling from the *host's* RAM, so on a 2 GB machine it
# lands near 1 GB — under what this repo's graph needs, and the build dies with "Reached heap
# limit" having already compiled successfully. That ceiling is V8's own, not the operating
# system's, which is why adding swap does not help: it has to be raised explicitly.
#
# Scoped to this stage. The `web` and `worker` stages are `FROM base`, so neither inherits it
# and no runtime process is handed a 3 GB heap. Override for a smaller box with
# `--build-arg NODE_BUILD_MEMORY=2048`.
ARG NODE_BUILD_MEMORY=3072
ENV NODE_OPTIONS=--max-old-space-size=${NODE_BUILD_MEMORY}
# `next build` prerenders pages that read the catalogue, and the image is built *before* the
# real database exists — docs/18 §4 migrates after the first boot, and `.env` is excluded from
# the build context on purpose, so there is no DATABASE_URL here at all. The client then falls
# back to `pglite://.data/pglite` and dies on `mkdir /repo/.data/pglite`, having already
# compiled and type-checked successfully, which reads like anything but a missing database.
#
# So give the build its own throwaway PGlite with the schema applied. Those pages prerender an
# empty catalogue rather than crashing: the home page renders per request and is unaffected,
# `/announcements` carries `revalidate = 300` and fills in within five minutes of first boot,
# and `generateStaticParams` simply finds nothing to pre-render and serves on demand instead.
#
# Deleted before the final stages copy `/repo`, so no database file reaches the image. The
# `DATABASE_URL` here never leaves this stage either — `web` and `worker` are `FROM base` and
# read the real one from the environment at runtime.
ENV DATABASE_URL=pglite://.data/build
RUN mkdir -p .data/build \
 && pnpm db:migrate \
 && pnpm turbo run build \
 && rm -rf .data

FROM base AS web
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/web
EXPOSE 3000
# `node scripts/serve.mjs`, not `pnpm start`, even though they run the same script: this is
# PID 1's child under the compose `init: true` tini, and every layer between tini and the
# process that owns the workers is one more place a SIGTERM can be dropped on `docker stop`.
# serve.mjs runs `next start` once per core and forwards the signal to each worker itself
# (WEB_CONCURRENCY; docs/20). One process per core, still one container and one port.
CMD ["node", "scripts/serve.mjs"]

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
