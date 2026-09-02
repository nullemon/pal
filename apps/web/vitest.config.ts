import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  // the `@/` alias from tsconfig, so route handlers can be imported by tests
  resolve: { alias: [{ find: /^@\//, replacement: `${root}/` }] },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts'],
  },
})
