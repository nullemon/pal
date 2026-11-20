import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * One process, one Postgres pool.
 *
 * `getDb()` and the synchronous `db` export used to build a pool each. Which meant every
 * process could hold twice `DATABASE_POOL_MAX`, two web processes could take the whole of
 * `max_connections` between them, and the site slowed to a crawl with every request queued
 * behind a connection — while `psql` answered "sorry, too many clients already" to the
 * operator trying to see what was wrong.
 *
 * The pool is counted at the only place it can be: calls to the `postgres` factory. Order
 * matters, because the old code shared correctly in one order and not the other, which is
 * exactly how it survived review.
 */

const factory = vi.fn(() => {
  const client = () => Promise.resolve([])
  // drizzle installs its own date parsers on the client it is handed, so the stand-in has
  // to carry the two maps it writes into.
  return Object.assign(client, {
    end: async () => undefined,
    options: { parsers: {}, serializers: {} },
  })
})

vi.mock('postgres', () => ({ default: factory }))

const load = async () => {
  vi.resetModules()
  return import('../client.js')
}

beforeEach(() => {
  factory.mockClear()
  process.env.DATABASE_URL = 'postgres://u:p@127.0.0.1:1/none'
})

afterEach(() => {
  delete process.env.DATABASE_URL
})

describe('the process-wide pool', () => {
  it('is shared when getDb() runs first — the order production takes', async () => {
    const mod = await load()
    await mod.getDb()
    // Touch the synchronous export the way the sixteen call sites that import it do.
    void mod.db.select
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('is shared when the synchronous export is touched first', async () => {
    const mod = await load()
    void mod.db.select
    await mod.getDb()
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('stays one pool however many times either is used', async () => {
    const mod = await load()
    await Promise.all([mod.getDb(), mod.getDb(), mod.getDbHandle()])
    void mod.db.select
    void mod.db.insert
    await mod.getDb()
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('builds a fresh pool after closeDb(), and still only one', async () => {
    const mod = await load()
    await mod.getDb()
    await mod.closeDb()
    await mod.getDb()
    void mod.db.select
    expect(factory).toHaveBeenCalledTimes(2)
  })
})
