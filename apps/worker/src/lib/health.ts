import { mkdir, rename, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/**
 * The worker's liveness signal (docs/18 §"health checks").
 *
 * `web` has a health check in `infra/docker-compose.yml` and `worker` had none, so a worker
 * that was *alive but wedged* — the tick throwing on every pass because Postgres is refusing
 * connections, a query that never returns — looked exactly like a healthy one from outside.
 * The only way to notice was that chapters stopped publishing.
 *
 * The signal is a small JSON file the scheduler tick writes after a pass that completed. It
 * is not an HTTP endpoint on purpose: the worker listens on nothing, and giving it a port
 * (and a server to keep alive, and a bind address to get wrong) to answer one question is
 * more moving parts than the question is worth. A file also fails in the right direction —
 * if the process is gone or hung, nothing rewrites it and it goes stale on its own.
 *
 * The file describes its own freshness (`staleMs`), so `scripts/healthcheck.mjs` needs no
 * copy of the threshold: it reads what the worker last wrote and compares `at` against now.
 *
 * Note that a Docker health check only *reports*; nothing restarts the container on it (that
 * is Swarm/Kubernetes behaviour, not compose). So a worker stuck against a database that is
 * down goes visibly unhealthy and stays running, which is what you want — restarting it would
 * not fix the database and would throw away whatever it could still do.
 */

export interface Heartbeat {
  /** ISO timestamp of the last tick that finished without throwing. */
  at: string
  pid: number
  /** How old `at` may get before this worker should be considered wedged. */
  staleMs: number
  /** Completed ticks since start — a worker that is running but never finishing shows 0. */
  ticks: number
  queue: string
  storage: string
  startedAt: string
}

/** Same expression in `scripts/healthcheck.mjs`; both resolve to /tmp on Linux. */
export const heartbeatFile = (): string =>
  process.env.WORKER_HEARTBEAT_FILE?.trim() || path.join(os.tmpdir(), 'palscans-worker.health')

/**
 * Three missed ticks, floor 90 s. Long enough that a slow pass (a big publish batch, a
 * stats rollup landing at the same time) is not called wedged, short enough that a worker
 * that has stopped doing anything is unhealthy inside two minutes.
 */
export const heartbeatStaleMs = (schedulerMs: number): number => Math.max(3 * schedulerMs, 90_000)

export interface HeartbeatWriter {
  readonly file: string
  /** Record a completed tick. Never throws — a full disk must not stop the worker. */
  touch(): Promise<void>
  ticks(): number
}

export const createHeartbeat = (opts: {
  file?: string
  staleMs: number
  queue: string
  storage: string
  now?: () => Date
  onError?: (err: unknown) => void
}): HeartbeatWriter => {
  const file = opts.file ?? heartbeatFile()
  const now = opts.now ?? (() => new Date())
  const startedAt = now().toISOString()
  let ticks = 0

  return {
    file,
    ticks: () => ticks,
    async touch() {
      ticks += 1
      const body: Heartbeat = {
        at: now().toISOString(),
        pid: process.pid,
        staleMs: opts.staleMs,
        ticks,
        queue: opts.queue,
        storage: opts.storage,
        startedAt,
      }
      try {
        await mkdir(path.dirname(file), { recursive: true })
        // Write-then-rename: the health check reads this file on its own schedule, and a
        // reader that catches a half-written one would flap the container between healthy
        // and not for no reason. `rename` within a directory is atomic.
        const tmp = `${file}.${process.pid}.tmp`
        await writeFile(tmp, `${JSON.stringify(body)}\n`, 'utf8')
        await rename(tmp, file)
      } catch (err) {
        opts.onError?.(err)
      }
    },
  }
}
