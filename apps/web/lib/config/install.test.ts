import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A guard for a bug that no other test could see.
 *
 * `getStorage()` only uses the operator's stored R2 credentials if something in the same
 * module graph has installed the resolver. Installing it from `instrumentation.ts` looks
 * right and silently does nothing — Next bundles instrumentation separately — so a module
 * that reaches for `getStorage` straight from `@palscans/core/storage` gets the environment's
 * credentials instead of the panel's, and uploads go to the wrong place with no error.
 *
 * Importing through `@/lib/storage` (which pulls in `lib/config/install`) is what makes it
 * correct. This walks the source and fails if anything bypasses that.
 */

const WEB_ROOT = path.resolve(__dirname, '../..')
const SKIP = new Set(['node_modules', '.next', 'test-results', '.turbo'])

const sourceFiles = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

describe('storage credential resolution', () => {
  it('is never bypassed by importing getStorage straight from core', () => {
    // `lib/storage/*` is the barrel itself and installs the resolver directly.
    const allowed = [path.join(WEB_ROOT, 'lib', 'storage'), path.join(WEB_ROOT, 'lib', 'config')]
    const offenders = sourceFiles(WEB_ROOT)
      .filter((f) => !allowed.some((a) => f.startsWith(a)))
      .filter((f) => {
        const src = readFileSync(f, 'utf8')
        // A value import of getStorage/createStorage from core, not a type-only import.
        return /import\s*\{[^}]*\bgetStorage\b[^}]*\}\s*from\s*'@palscans\/core\/storage'/.test(src)
      })
      .map((f) => path.relative(WEB_ROOT, f))

    expect(offenders).toEqual([])
  })

  it('installs both resolvers, not just storage', () => {
    // The credential slot feeds the modules shared with the worker (notifications, Discord,
    // mail). It was originally installed from instrumentation.ts and therefore never was —
    // the slot stayed empty and those modules read the environment while the panel held a
    // value, with nothing reporting a problem.
    const install = readFileSync(path.join(WEB_ROOT, 'lib', 'config', 'install.ts'), 'utf8')
    expect(install).toContain('installStorageResolver()')
    expect(install).toContain('installCredentialResolver()')
  })

  it('keeps the barrel wired to the installer', () => {
    const barrel = readFileSync(path.join(WEB_ROOT, 'lib', 'storage', 'index.ts'), 'utf8')
    expect(barrel).toContain("import '../config/install'")
  })
})
