import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

/**
 * The public copy catalogue must not carry admin-only copy.
 *
 * `messages` is one frozen object, so a client component reading a single string pulls the
 * whole thing into the browser. That is why the admin panel's copy lives in
 * `@palscans/core/messages/admin` (docs/20 "Front-end budgets") — and why the split needs a
 * guard rather than a convention: three sections were added without an `admin` prefix after
 * the split and went straight back onto every reader's phone until somebody measured.
 *
 * The rule this asserts: a top-level section of `messages` that is read *only* from
 * `/admin` paths belongs in `adminMessages`. Sections read from both, or from neither
 * (server-only copy, notification bodies), are fine where they are.
 */
const WEB = join(import.meta.dirname, '..')
const MESSAGES = join(WEB, '../../packages/core/src/messages.ts')

/** Top-level keys of the frozen literal: two-space indent, then `name: {`. */
const publicSections = (): string[] =>
  [...readFileSync(MESSAGES, 'utf8').matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*): \{$/gm)].map(
    (m) => m[1] as string,
  )
const SKIP = new Set(['node_modules', '.next', 'test-results', 'playwright-report', 'dist'])

const sourceFiles = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) sourceFiles(p, out)
    else if (/\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

it('every admin-only section lives in the admin catalogue, not the public one', () => {
  const files = sourceFiles(WEB).map(
    (p) => [p.slice(WEB.length + 1), readFileSync(p, 'utf8')] as const,
  )
  const leaked: string[] = []
  const sections = publicSections()
  expect(sections.length).toBeGreaterThan(20)
  for (const section of sections) {
    const use = new RegExp(String.raw`(?<![A-Za-z.])messages\.${section}\b`)
    const readers = files.filter(
      ([p, src]) => !p.endsWith('messages-split.test.ts') && use.test(src),
    )
    if (readers.length && readers.every(([p]) => p.includes('/admin'))) leaked.push(section)
  }
  expect(leaked, 'move these to packages/core/src/messages/admin.ts — see docs/20').toEqual([])
})
