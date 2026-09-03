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
  },
})
