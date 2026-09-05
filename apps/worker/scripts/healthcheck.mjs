#!/usr/bin/env node
/**
 * The `worker` service's Docker health check (infra/docker-compose.yml).
 *
 * The worker serves nothing, so there is no request to probe. It writes a heartbeat file
 * after every scheduler tick that completed (apps/worker/src/lib/health.ts) and this reads
 * it: fresh → exit 0, stale, missing or unparseable → exit 1 with a line saying which.
 *
 * Deliberately dependency-free (plain .mjs, no tsx) and it holds no copy of the threshold —
 * the heartbeat carries its own `staleMs`, so changing WORKER_SCHEDULER_MS cannot leave this
 * file checking against a number nobody updated. The only thing both sides must agree on is
 * where the file lives, and both compute the same default.
 *
 *   node scripts/healthcheck.mjs        # from /repo/apps/worker
 */
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const FALLBACK_STALE_MS = 90_000

const file =
  process.env.WORKER_HEARTBEAT_FILE?.trim() || path.join(os.tmpdir(), 'palscans-worker.health')

const unhealthy = (message) => {
  console.error(`worker unhealthy: ${message} (${file})`)
  process.exit(1)
}

let raw
try {
  raw = await readFile(file, 'utf8')
} catch (err) {
  // ENOENT before the first tick is indistinguishable from ENOENT after a crash, which is
  // why the compose check has a `start_period`: failures inside it do not count.
  unhealthy(err.code === 'ENOENT' ? 'no heartbeat yet' : `heartbeat unreadable: ${err.code}`)
}

let beat
try {
  beat = JSON.parse(raw)
} catch {
  unhealthy('heartbeat is not JSON')
}

const at = Date.parse(beat?.at ?? '')
if (Number.isNaN(at)) unhealthy('heartbeat has no usable timestamp')

const staleMs = Number.isFinite(beat.staleMs) && beat.staleMs > 0 ? beat.staleMs : FALLBACK_STALE_MS
const age = Date.now() - at
if (age > staleMs)
  unhealthy(
    `last completed tick ${Math.round(age / 1000)}s ago, over the ${Math.round(staleMs / 1000)}s limit`,
  )

process.exit(0)
