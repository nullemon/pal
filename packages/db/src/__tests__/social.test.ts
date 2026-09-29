import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db, type DbHandle } from '../client.js'
import { runMigrations } from '../migrate.js'
import { socialAccounts, socialPosts } from '../schema/index.js'

/**
 * The social ledger's double-post guard (migration 9042).
 *
 * The constraint is the whole point of the table, so it is asserted against a real database
 * rather than trusted from the DDL. A duplicate notification is waste; a duplicate social
 * post is public and permanent, and the ordinary ways to get one — a retried job, a worker
 * restart mid-publish, an operator pressing the button twice — all end at an INSERT that
 * looks perfectly reasonable in isolation.
 *
 * Two properties have to hold together, and it is easy to write an index that gets one and
 * breaks the other: a successful post can never be duplicated, *and* a failed attempt can
 * always be retried.
 */

let dir: string
let handle: DbHandle
let db: Db
let accountId: number

const post = (over: Partial<typeof socialPosts.$inferInsert> = {}) => ({
  accountId,
  platform: 'bluesky' as const,
  kind: 'chapter',
  status: 'sent',
  dedupeKey: 'chapter:412:bluesky',
  ...over,
})

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'palscans-social-'))
  handle = await createDb(`pglite://${path.join(dir, 'pg')}`)
  db = handle.db
  await runMigrations(handle)
  const [row] = await db
    .insert(socialAccounts)
    .values({
      platform: 'bluesky',
      handle: '@palscans.bsky.social',
      credentials: Buffer.from('sealed-not-a-real-credential'),
    })
    .returning({ id: socialAccounts.id })
  accountId = row?.id ?? 0
})

afterAll(async () => {
  await handle?.close?.()
  if (dir) await rm(dir, { recursive: true, force: true })
})

describe('social_posts dedupe guard', () => {
  it('accepts the first post for a key', async () => {
    const rows = await db.insert(socialPosts).values(post()).returning({ id: socialPosts.id })
    expect(rows).toHaveLength(1)
  })

  it('refuses a second successful post for the same key', async () => {
    await expect(db.insert(socialPosts).values(post())).rejects.toThrow()
  })

  it('refuses a queued duplicate too, not just a sent one', async () => {
    // The race that matters: the job is enqueued twice before either has posted.
    await expect(db.insert(socialPosts).values(post({ status: 'queued' }))).rejects.toThrow()
  })

  it('allows the same chapter on a different platform', async () => {
    const rows = await db
      .insert(socialPosts)
      .values(post({ platform: 'x', dedupeKey: 'chapter:412:x' }))
      .returning({ id: socialPosts.id })
    expect(rows).toHaveLength(1)
  })

  it('allows a failed attempt alongside a success, and repeated failures', async () => {
    // Failures are excluded from the index precisely so a retry can still insert; without
    // that, one transient network error would block the chapter from ever going out.
    for (const _ of [1, 2, 3])
      await db.insert(socialPosts).values(post({ status: 'failed', detail: 'timeout' }))
    const rows = await db.select().from(socialPosts)
    expect(rows.filter((r) => r.status === 'failed')).toHaveLength(3)
  })

  it('does not constrain rows without a key, so manual posts stay free', async () => {
    for (const _ of [1, 2])
      await db.insert(socialPosts).values(post({ kind: 'manual', dedupeKey: null }))
    const manual = (await db.select().from(socialPosts)).filter((r) => r.kind === 'manual')
    expect(manual).toHaveLength(2)
  })
})

describe('social_accounts', () => {
  it('keeps the ledger when an account is disconnected', async () => {
    // SET NULL, not cascade: "did that chapter go out?" has to stay answerable after the
    // account is gone, which is why `platform` is denormalised onto every ledger row.
    const before = await db.select().from(socialPosts)
    await db.delete(socialAccounts)
    const after = await db.select().from(socialPosts)
    expect(after).toHaveLength(before.length)
    expect(after.every((r) => r.accountId === null)).toBe(true)
    expect(after.every((r) => r.platform.length > 0)).toBe(true)
  })
})
