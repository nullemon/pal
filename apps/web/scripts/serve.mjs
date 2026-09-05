#!/usr/bin/env node
/**
 * The production entry point for the web app: `next start`, one process per core.
 *
 * Why this exists (docs/20-performance.md): `next start` is a single Node process and React
 * server rendering is synchronous work on its event loop, so one process costs ~30 ms of CPU
 * per reader page and tops out at ~30 pages/second no matter how many readers arrive. The
 * load test showed throughput flat from 1 to 32 concurrent readers while latency rose in
 * exact proportion — one queue, one server — at 1.07 of 4 cores busy. Three cores were idle.
 *
 * So this script is `next start` behind Node's `cluster` module: one listening socket, N
 * worker processes, connections handed out round-robin by the primary. Nothing above it
 * changes — one container, one port, one PID to signal, `reverse_proxy web:3000` in the
 * Caddyfile, one `docker compose exec web`, and the compose health check still probes the
 * same `/api/health`.
 *
 *   WEB_CONCURRENCY=4 node scripts/serve.mjs      # or `pnpm start`
 *
 * Configuration:
 *   WEB_CONCURRENCY   worker processes (default: os.availableParallelism(), i.e. core count)
 *                     `1` runs `next start` in *this* process, with no supervisor at all —
 *                     byte-identical to what shipped before this script existed.
 *                     `auto` / `0` / unset means the default.
 *   PORT              the port every worker shares (default 3000)
 *   WEB_HOSTNAME      bind address, passed through to `next start -H` (default: Next's 0.0.0.0).
 *                     Deliberately not `HOSTNAME`: Docker sets that to the container id in
 *                     every container, and binding the server to it would take the listener
 *                     off 0.0.0.0 and break the compose health check, which probes 127.0.0.1.
 *                     `next start` ignores `HOSTNAME` for the same reason — it binds `-p`
 *                     from `PORT` but has no env binding for `-H`.
 *   WEB_SHUTDOWN_TIMEOUT_MS   how long a worker gets to drain before SIGKILL (default 15000)
 *   WEB_RESTART_MAX / WEB_RESTART_WINDOW_MS   crash-loop guard (default 10 restarts / 60 s)
 *
 * Flags: `--workers N` (wins over WEB_CONCURRENCY), `--port N`, `--hostname H`.
 *
 * ## What N processes do to the app's in-process state
 *
 * Nothing in the app is *incorrect* with N processes, but three module-level caches are
 * per-process and now exist N times over. Stated in full because "it just works" is not a
 * useful thing to read at 2am:
 *
 * 1. **The view buffer** (`packages/core/src/views.ts`, driven by `apps/web/lib/views/record.ts`).
 *    Each worker has its own buffer and flushes it independently — 200 rows or 2 s, whichever
 *    comes first. Counting stays honest because neither of the two things that make a view
 *    unique is in the process: the `SET NX PX` dedupe claim is in Redis, and `view_events`'
 *    primary key (viewer × series × chapter × UTC day) is the final word. What changes is the
 *    *batching*: each worker sees 1/N of the beacons, so at low traffic the same rows go out
 *    as N smaller INSERTs (up to N × 0.5/s instead of 0.5/s) — under load the 200-row trigger
 *    fires in every worker anyway and the statement rate is unchanged. The 2 s window a hard
 *    kill loses is still 2 s; there are simply N buffers holding a share of it. `maxQueued`
 *    (20 000) is also per worker, so a database outage now parks up to N × 20 000 hits.
 *
 * 2. **The settings / credentials memo** (`apps/web/lib/config/store.ts`, `CACHE_TTL_MS` 30 s,
 *    and the mirror it writes through to). `purgeConfigCache()` clears the memo of *the
 *    worker that handled the save*, so that worker is correct immediately and the other N−1
 *    are up to 30 s stale. docs/19 already says a credential change reaches other processes
 *    within 30 s; with N web workers that sentence now covers the web tier too. The visible
 *    shape of it: save an integration, reload, and the reload may land on a worker that has
 *    not re-read yet. Nothing is served *wrong* — precedence and sealing are unchanged, and
 *    the TTL is the invalidation mechanism — but "I saved it and it didn't take" is expected
 *    for up to 30 seconds rather than instant. The same applies to the 60 s proxy snapshot in
 *    `apps/web/proxy.ts` (staff path, panel IP allowlist, redirects), which is per process too.
 *
 * 3. **The Redis-less fallbacks.** With `REDIS_URL` unset the rate limiter
 *    (`apps/web/lib/auth/rate-limit.ts`) and the view dedupe both fall back to an in-process
 *    Map. Those are per worker, so N processes multiply every limit by N — login 5/min
 *    becomes up to 5N/min for an attacker whose connections land on different workers. That
 *    is a real weakening and it is why production sets `REDIS_URL`; the preflight
 *    (`scripts/preflight.mjs`) says so out loud rather than leaving it to be discovered.
 *
 * Memory is the other cost: each worker is a full Next server, so budget ~200–250 MB each.
 * On the 4 vCPU / 8 GB box docs/18 §0 recommends, 4 workers plus Postgres, Valkey and the
 * worker fit comfortably; lower `WEB_CONCURRENCY` if you are on a smaller machine.
 *
 * **The background worker is not clustered and must not be.** `apps/worker` holds the publish
 * scheduler, the stats rollup and the nightly backup on interval timers; N copies would run
 * each of them N times. It stays one process — a separate compose service with its own
 * single-process CMD.
 */
import cluster from 'node:cluster'
import { createRequire } from 'node:module'
import os from 'node:os'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
/** `next start` itself — the same file `pnpm exec next` runs, so no behaviour is re-implemented. */
const NEXT_BIN = require.resolve('next/dist/bin/next')

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? undefined : args[i + 1]
}

const fail = (message) => {
  console.error(`serve: ${message}`)
  process.exit(1)
}

/**
 * How many workers to run. Anything that is not a positive integer is an error rather than a
 * silent fallback: `WEB_CONCURRENCY=four` quietly serving on one core is exactly the failure
 * this script exists to end.
 */
const workerCount = () => {
  const raw = (flag('workers') ?? process.env.WEB_CONCURRENCY ?? '').trim()
  const cores = os.availableParallelism()
  if (raw === '' || raw === 'auto' || raw === '0') return cores
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1)
    fail(
      `WEB_CONCURRENCY must be a positive integer or "auto" (got ${JSON.stringify(raw)}). ` +
        `This box has ${cores} cores; leave it unset to use all of them.`,
    )
  if (n > cores * 2)
    console.warn(
      `[serve] WEB_CONCURRENCY=${n} on a ${cores}-core box: extra workers add memory and ` +
        `context switching, not throughput. One per core is the number docs/20 measured.`,
    )
  return n
}

const positiveInt = (raw, fallback) => {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

const PORT = flag('port') ?? process.env.PORT ?? '3000'
const HOSTNAME = flag('hostname') ?? process.env.WEB_HOSTNAME
const WORKERS = workerCount()
const SHUTDOWN_TIMEOUT_MS = positiveInt(process.env.WEB_SHUTDOWN_TIMEOUT_MS, 15_000)
const RESTART_MAX = positiveInt(process.env.WEB_RESTART_MAX, 10)
const RESTART_WINDOW_MS = positiveInt(process.env.WEB_RESTART_WINDOW_MS, 60_000)

/** Next's own "restart me, I am near the heap limit" exit code (server/lib/utils.ts). */
const NEXT_RESTART_EXIT_CODE = 77
const SIGNAL_EXIT_CODE = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 }

const nextArgs = ['start', '-p', String(PORT), ...(HOSTNAME ? ['-H', HOSTNAME] : [])]

// --------------------------------------------------------------- one process

/**
 * One worker means one process: run `next start` right here rather than supervising a single
 * child. That keeps `WEB_CONCURRENCY=1` an exact description of the old deployment — same
 * PID, same signal handling, same "Ready in" line — so the before/after in docs/20 differs
 * only in how many processes are serving.
 */
if (WORKERS === 1) {
  process.argv = [process.execPath, NEXT_BIN, ...nextArgs]
  await import(pathToFileURL(NEXT_BIN).href)
} else {
  // ------------------------------------------------------------- the primary

  // Round-robin: the primary accepts and hands each *connection* to the next worker. The
  // alternative (SCHED_NONE, every worker accepting on a shared socket) leaves the split to
  // the kernel and skews badly under keep-alive. Connections, not requests — a proxy holding
  // one upstream connection pins to one worker, which is why Caddy's pool (32 idle
  // connections per host by default) matters and why a single-connection benchmark sees no
  // improvement at all. Real concurrency opens real connections.
  cluster.schedulingPolicy = cluster.SCHED_RR
  cluster.setupPrimary({ exec: NEXT_BIN, args: nextArgs })

  let shuttingDown = false
  /** Fork times inside the rolling window — a boot that cannot succeed must not spin forever. */
  let restarts = []
  let forceTimer = null

  const fork = () => {
    const worker = cluster.fork()
    worker.on('exit', (code, signal) => onWorkerExit(worker, code, signal))
    return worker
  }

  const liveWorkers = () => Object.values(cluster.workers ?? {}).filter((w) => w && !w.isDead())

  function onWorkerExit(worker, code, signal) {
    if (shuttingDown) {
      if (liveWorkers().length === 0) finishShutdown()
      return
    }
    const deliberate = code === NEXT_RESTART_EXIT_CODE
    console.error(
      deliberate
        ? `[serve] worker ${worker.process.pid} asked to be restarted (heap near the limit)`
        : `[serve] worker ${worker.process.pid} exited (${signal ? `signal ${signal}` : `code ${code}`}); restarting`,
    )
    const now = Date.now()
    restarts = restarts.filter((t) => now - t < RESTART_WINDOW_MS)
    restarts.push(now)
    if (restarts.length > RESTART_MAX) {
      console.error(
        `[serve] ${restarts.length} worker restarts in ${Math.round(RESTART_WINDOW_MS / 1000)}s — ` +
          'the workers cannot stay up. The error above is the reason: read it, fix it, and ' +
          'start again. Common causes are an invalid environment (apps/web/lib/env.ts names ' +
          'the variable), an unreachable DATABASE_URL, or a missing production build. ' +
          'Run `node scripts/preflight.mjs` for the full list.',
      )
      shuttingDown = true
      for (const w of liveWorkers()) w.process.kill('SIGKILL')
      process.exit(1)
    }
    fork()
  }

  function finishShutdown() {
    if (forceTimer) clearTimeout(forceTimer)
    process.exit(SIGNAL_EXIT_CODE[shuttingDown] ?? 0)
  }

  /**
   * One Ctrl-C, or one `docker stop`, takes the whole thing down.
   *
   * Both cases have to work and they arrive differently. A terminal sends SIGINT to the whole
   * foreground process group, so the workers get it too and Next's own handler (which ignores
   * a duplicate signal) starts draining; `docker stop` sends SIGTERM to PID 1 only, so the
   * primary has to pass it on. Forwarding covers both — the duplicate is harmless — and each
   * worker then does the graceful close `next start` already implements: stop accepting,
   * finish in-flight requests, close the Next server, exit. The primary waits for the last
   * one and exits with the signal's conventional code so the shell and Docker see a signal
   * termination rather than a crash.
   */
  const shutdown = (signal) => {
    if (shuttingDown) return
    shuttingDown = signal
    console.log(`[serve] ${signal}: draining ${liveWorkers().length} worker(s)`)
    for (const worker of liveWorkers()) {
      // The raw signal, not worker.kill(): disconnecting the IPC channel first can cut the
      // worker short before Next has finished its own cleanup.
      try {
        worker.process.kill(signal)
      } catch {
        // already gone
      }
    }
    if (liveWorkers().length === 0) return finishShutdown()
    forceTimer = setTimeout(() => {
      const stuck = liveWorkers()
      if (stuck.length)
        console.error(
          `[serve] ${stuck.length} worker(s) still draining after ${SHUTDOWN_TIMEOUT_MS}ms; killing`,
        )
      for (const worker of stuck) worker.process.kill('SIGKILL')
      finishShutdown()
    }, SHUTDOWN_TIMEOUT_MS)
    forceTimer.unref()
  }

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => shutdown(signal))

  console.log(
    `[serve] starting ${WORKERS} next workers on port ${PORT} ` +
      `(${os.availableParallelism()} cores, WEB_CONCURRENCY=${process.env.WEB_CONCURRENCY ?? 'unset'})`,
  )
  for (let i = 0; i < WORKERS; i++) fork()
}
