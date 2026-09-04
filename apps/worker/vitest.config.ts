import { defineConfig } from 'vitest/config'

/**
 * Several suites here boot their own PGlite database. Booting three of them at once on a
 * four-core box takes longer than vitest's 10 s default hook timeout, so the suites are run
 * one file at a time with the same generous limits `packages/db` uses.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
})
