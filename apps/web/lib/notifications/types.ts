import type { getDb } from '@palscans/db'

/**
 * The database handle the notification modules take. Awaiting `getDb()` here keeps every
 * module free of a client of its own, so the worker and the web app inject the one they
 * already opened (and tests inject a PGlite one).
 */
export type NotifyDb = Awaited<ReturnType<typeof getDb>>

/** Injectable `fetch`, so no test ever reaches the network. */
export type FetchLike = typeof fetch
