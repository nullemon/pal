import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * A `'use client'` file may not *run* code from a package barrel that re-exports server-only
 * modules.
 *
 * `@palscans/core`'s index re-exports `queue/index.js`, which reaches bullmq and ioredis, which
 * require `tls` and `worker_threads`. None of those exist in a browser bundle, so one value
 * import of the barrel from a client component fails `next build` with a wall of
 * `Module not found` — and it fails nowhere else. Typecheck passes, every unit test passes,
 * and the first thing that notices is a Docker build twenty minutes into a deployment.
 *
 * Type-only imports are fine and stay allowed: they are erased before bundling, so they create
 * no runtime edge. That distinction is the whole reason this needs a real check rather than a
 * grep — `import type { Feature } from '@palscans/core'` in a client component is correct, and
 * `import { slugify } from '@palscans/core'` two lines above it brings the site down.
 *
 * The fix is never to stop using the value; it is to import it from the subpath export that
 * package.json already publishes for it (`@palscans/core/slug`, `/permissions`, `/formatting`
 * …). Those exist precisely so client code can take one leaf without the barrel.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../../..')

/** Barrels that reach server-only code. Their subpath exports are unaffected. */
const SERVER_BARRELS = ['@palscans/core', '@palscans/db']

const SCANNED = ['apps/web', 'packages/ui']
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.turbo', '.data'])

const sourceFiles = (dir: string): string[] => {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...sourceFiles(full))
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/** The `'use client'` directive has to be the first statement, so only the head matters. */
const isClientComponent = (source: string): boolean =>
  /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*|\n)*['"]use client['"]/.test(source)

/**
 * Every import of `spec` in `source` that survives to runtime: a side-effect import, or one
 * whose clause is not wholly type-only. `import { type A, b }` counts — `b` is a value.
 *
 * The clause pattern excludes quotes rather than only semicolons. The formatter writes no
 * semicolons, so a `[^;]` clause runs straight through the end of one import statement and
 * into the next, and a run of neighbouring imports gets reported as one false hit. A module
 * specifier is the only quoted thing between `import` and `from`, so refusing quotes stops
 * the match at the statement it started in. Newlines stay allowed: a braced clause wraps.
 */
const valueImportsOf = (source: string, spec: string): string[] => {
  const quoted = `['"]${spec.replace('/', '\\/')}['"]`
  const found: string[] = []
  for (const m of source.matchAll(new RegExp(`^\\s*import\\s+([^'";]*?)from\\s*${quoted}`, 'gm'))) {
    if (!/^type\s/.test((m[1] ?? '').trim())) found.push(m[0].trim())
  }
  for (const m of source.matchAll(new RegExp(`^\\s*import\\s*${quoted}`, 'gm')))
    found.push(m[0].trim())
  return found
}

describe('client components and server-only barrels', () => {
  const clientFiles = SCANNED.flatMap((dir) => sourceFiles(path.join(repoRoot, dir)))
    .filter((file) => isClientComponent(readFileSync(file, 'utf8')))
    .map((file) => ({ file, rel: path.relative(repoRoot, file) }))

  it('finds the client components to check', () => {
    // A rename that empties the scan would make every assertion below vacuously true.
    expect(clientFiles.length).toBeGreaterThan(20)
  })

  it.each(SERVER_BARRELS)('no client component runs code from the %s barrel', (barrel) => {
    const offenders = clientFiles.flatMap(({ file, rel }) =>
      valueImportsOf(readFileSync(file, 'utf8'), barrel).map((line) => `${rel}: ${line}`),
    )
    expect(offenders).toEqual([])
  })
})
