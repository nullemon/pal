import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      // the `@/` alias from tsconfig, so route handlers can be imported by tests
      { find: /^@\//, replacement: `${root}/` },
      // `server-only` is resolved by Next, not by node — see test/server-only.ts
      { find: /^server-only$/, replacement: `${root}/test/server-only.ts` },
    ],
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts'],
    /**
     * Six suites build a throwaway database in `beforeAll` — `createDb('pglite://memory')`
     * then the whole migration set — which is a second or two idle and well past Vitest's 10s
     * default when several workers are doing it at once on a busy machine. The number of test
     * files is not supposed to be load-bearing: adding one elsewhere in the suite should not
     * make a database fixture time out, which is exactly what happened here.
     */
    // Matches `apps/worker` and `packages/db`, which boot the same fixtures.
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
})
