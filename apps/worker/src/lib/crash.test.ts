import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * An unhandled rejection must be logged, not fatal — checked by running real processes,
 * because the thing being tested is Node's own default and no amount of mocking can show it.
 *
 * The stakes: `chapter-process` fires a progress `db.update` every 750 ms for the length of an
 * encode. Before this, one transient Postgres error there took the whole worker down mid
 * chapter, leaving the row in `processing` for the 30-minute stale sweep and crash-looping for
 * as long as Postgres was unhappy.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const workerRoot = path.resolve(here, '../..')
const crashModule = pathToFileURL(path.join(here, 'crash.ts')).href

let dir: string

const run = async (
  source: string,
): Promise<{ code: number | null; signal: string | null; out: string }> => {
  const file = path.join(dir, `fixture-${Math.random().toString(36).slice(2)}.ts`)
  await writeFile(file, source, 'utf8')
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', file], {
      cwd: workerRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_OPTIONS: '' },
    })
    let out = ''
    child.stdout.on('data', (b: Buffer) => {
      out += b.toString()
    })
    child.stderr.on('data', (b: Buffer) => {
      out += b.toString()
    })
    child.on('error', reject)
    child.on('close', (code, signal) => resolve({ code, signal, out }))
  })
}

/** Rejects on a timer the way a background `db.update` does, then reports whether we lived. */
const fixture = (guard: boolean) => `
${guard ? `import { installCrashGuards } from ${JSON.stringify(crashModule)}\ninstallCrashGuards()` : ''}
setTimeout(() => {
  void Promise.reject(new Error('too many clients already'))
}, 10)
setTimeout(() => {
  console.log('STILL-RUNNING')
  process.exit(0)
}, 400)
`

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'palscans-crash-'))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('installCrashGuards', () => {
  it('this Node kills a process on an unhandled rejection (the reason the guard exists)', async () => {
    const result = await run(fixture(false))

    expect(result.out).not.toContain('STILL-RUNNING')
    expect(result.code).not.toBe(0)
    expect(result.out).toContain('too many clients already')
  }, 30_000)

  it('logs the rejection and keeps the process alive', async () => {
    const result = await run(fixture(true))

    expect(result.out).toContain('STILL-RUNNING')
    expect(result.code).toBe(0)
    expect(result.out).toContain('unhandled rejection (worker kept running)')
    expect(result.out).toContain('too many clients already')
  }, 30_000)
})
