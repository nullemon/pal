import {
  announcements,
  createDb,
  type Db,
  type DbHandle,
  genres,
  runMigrations,
  series,
  slugHistory,
} from '@palscans/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { EMPTY_SNAPSHOT, resolveProxy } from './proxy'
import { loadProxySnapshot } from './snapshot'

/**
 * What the proxy is told about renamed and retired entities, read out of a real database.
 *
 * `seo.test.ts` proves what `resolveProxy` does with a snapshot; this proves the snapshot it
 * is given. The two halves meet in `answer()` below, which runs the real rules over the real
 * rows — because the bug this file exists to catch is not in either half alone. Every row
 * here was individually correct while `/series/<old>` still redirected into a 410.
 */

vi.mock('../auth/invites', () => ({
  readAccessSetting: async () => ({ staff_path: '/admin/login', panel_ips: [] }),
}))

let handle: DbHandle
let db: Db

const addSeries = async (slug: string, over: Partial<typeof series.$inferInsert> = {}) => {
  const [row] = await db
    .insert(series)
    .values({ slug, title: slug, type: 'manhwa', state: 'published', ...over })
    .returning({ id: series.id })
  return row?.id as number
}

/** Rename, the way the admin save does it: history row first, then the new slug. */
const rename = async (id: number, from: string, to: string) => {
  await db.insert(slugHistory).values({ entityType: 'series', oldSlug: from, entityId: id })
  await db.update(series).set({ slug: to }).where(eq(series.id, id))
}

/** The proxy's own answer for a path, from the snapshot the database produces. */
const answer = async (path: string) => {
  const snapshot = await loadProxySnapshot(db)
  return resolveProxy({ ...EMPTY_SNAPSHOT, ...snapshot }, new URL(`http://127.0.0.1:3000${path}`))
}

beforeAll(async () => {
  handle = await createDb('pglite://memory')
  db = handle.db
  await runMigrations(handle)
}, 180_000)

afterAll(async () => {
  await handle?.close()
})

describe('slug history in the proxy snapshot', () => {
  it('301s an old series URL to the slug the series has now', async () => {
    const id = await addSeries('frost-monarch')
    await rename(id, 'frost-monarch', 'return-of-the-frost-monarch')
    expect(await answer('/series/frost-monarch')).toEqual({
      kind: 'redirect',
      location: '/series/return-of-the-frost-monarch',
      status: 301,
    })
    // and the path under it comes along, which is the whole reason history is kept
    expect(await answer('/series/frost-monarch/chapter-3')).toMatchObject({
      location: '/series/return-of-the-frost-monarch/chapter-3',
    })
  })

  it('410s both slugs of a renamed series that was then trashed, without a hop through a 301', async () => {
    const id = await addSeries('ashfall')
    await rename(id, 'ashfall', 'ashfall-regent')
    await db.update(series).set({ deletedAt: new Date() }).where(eq(series.id, id))
    // The current slug is gone — that much was always true.
    expect(await answer('/series/ashfall-regent')).toEqual({ kind: 'gone', slug: 'ashfall-regent' })
    // The old one must say so itself. A 301 here would send a crawler to the 410 above:
    // two requests, and an old URL that looks alive for the length of the first one.
    expect(await answer('/series/ashfall')).toEqual({ kind: 'gone', slug: 'ashfall' })
  })

  it('does the same for a series removed from the catalogue rather than trashed', async () => {
    const id = await addSeries('greywater')
    await rename(id, 'greywater', 'chronicles-of-greywater')
    await db.update(series).set({ state: 'removed' }).where(eq(series.id, id))
    expect(await answer('/series/greywater')).toEqual({ kind: 'gone', slug: 'greywater' })
    expect(await answer('/series/chronicles-of-greywater')).toEqual({
      kind: 'gone',
      slug: 'chronicles-of-greywater',
    })
  })

  it('keeps the genre rule it already had, and treats announcements the same way', async () => {
    const [genre] = await db
      .insert(genres)
      .values({ slug: 'akushon', name: 'Akushon' })
      .returning({ id: genres.id })
    const genreId = genre?.id as number
    await db
      .insert(slugHistory)
      .values({ entityType: 'genre', oldSlug: 'akushon', entityId: genreId })
    await db.update(genres).set({ slug: 'action' }).where(eq(genres.id, genreId))
    expect(await answer('/genres/akushon')).toMatchObject({ location: '/genres/action' })
    // A deleted genre drops out of history: there is no 410 list for genres, so the old slug
    // 404s rather than redirecting to one.
    await db.update(genres).set({ deletedAt: new Date() }).where(eq(genres.id, genreId))
    expect(await answer('/genres/akushon')).toMatchObject({ kind: 'next' })

    const [post] = await db
      .insert(announcements)
      .values({ slug: 'hello', title: 'Hello', body: { type: 'doc', children: [] } })
      .returning({ id: announcements.id })
    const postId = post?.id as number
    await db
      .insert(slugHistory)
      .values({ entityType: 'announcement', oldSlug: 'hello', entityId: postId })
    await db.update(announcements).set({ slug: 'welcome' }).where(eq(announcements.id, postId))
    expect(await answer('/announcements/hello')).toMatchObject({
      location: '/announcements/welcome',
    })
  })
})
