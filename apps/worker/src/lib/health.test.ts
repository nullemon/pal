import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHeartbeat, type Heartbeat, heartbeatStaleMs } from './health.js'

/**
 * The worker's health check, both halves: the file the tick writes and the script Docker
 * runs against it. The script is spawned for real rather than imported — it is what the
 * compose `test:` line executes, and its exit code is the entire contract.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const script = path.resolve(here, '../../scripts/healthcheck.mjs')

let dir: string

const check = async (file: string): Promise<{ code: number | null; out: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, WORKER_HEARTBEAT_FILE: file },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (b: Buffer) => {
      out += b.toString()
    })
    child.stderr.on('data', (b: Buffer) => {
      out += b.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, out }))
  })

const read = async (file: string): Promise<Heartbeat> =>
  JSON.parse(await readFile(file, 'utf8')) as Heartbeat

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'palscans-health-'))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('heartbeat', () => {
  it('records a completed tick, and the check passes on it', async () => {
    const file = path.join(dir, 'fresh.health')
    const beat = createHeartbeat({ file, staleMs: 90_000, queue: 'memory', storage: 'fs' })
    await beat.touch()

    const written = await read(file)
    expect(written.ticks).toBe(1)
    expect(written.pid).toBe(process.pid)
    expect(written.staleMs).toBe(90_000)
    expect(written.queue).toBe('memory')
    expect(Date.now() - Date.parse(written.at)).toBeLessThan(5_000)

    expect((await check(file)).code).toBe(0)
  }, 30_000)

  it('fails the check once the last completed tick is older than the file says it may be', async () => {
    const file = path.join(dir, 'stale.health')
    const beat = createHeartbeat({
      file,
      // The value the file carries is what the script compares against, so a short one here
      // is a real stale worker rather than a doctored clock.
      staleMs: 50,
      queue: 'bullmq',
      storage: 's3',
      now: () => new Date(Date.now() - 60_000),
    })
    await beat.touch()

    const result = await check(file)
    expect(result.code).toBe(1)
    expect(result.out).toContain('over the')
  }, 30_000)

  it('fails when the worker never wrote one, or wrote nonsense', async () => {
    const missing = await check(path.join(dir, 'nothing-here.health'))
    expect(missing.code).toBe(1)
    expect(missing.out).toContain('no heartbeat yet')

    const junk = path.join(dir, 'junk.health')
    await writeFile(junk, 'half a write', 'utf8')
    const broken = await check(junk)
    expect(broken.code).toBe(1)
    expect(broken.out).toContain('not JSON')
  }, 30_000)

  it('never throws at the worker when the file cannot be written', async () => {
    const errors: unknown[] = []
    const beat = createHeartbeat({
      // A path whose parent is a file, so `mkdir` fails: a full or read-only disk must
      // degrade to "unhealthy", never to "the worker stopped".
      file: path.join(dir, 'junk.health', 'nested', 'x.health'),
      staleMs: 1_000,
      queue: 'memory',
      storage: 'fs',
      onError: (err) => errors.push(err),
    })

    await expect(beat.touch()).resolves.toBeUndefined()
    expect(errors).toHaveLength(1)
  })

  it('allows three missed ticks, with a floor for very short intervals', () => {
    expect(heartbeatStaleMs(30_000)).toBe(90_000)
    expect(heartbeatStaleMs(60_000)).toBe(180_000)
    expect(heartbeatStaleMs(1_000)).toBe(90_000)
  })
})
