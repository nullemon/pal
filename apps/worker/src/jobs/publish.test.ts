import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_EARLY_ACCESS_MINUTES } from '@palscans/core'
import {
  chapters,
  createDb,
  type Db,
  type DbHandle,
  runMigrations,
  series,
  settings,
  users,
} from '@palscans/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { publishDue } from './publish.js'

/**
 * The early-access window is applied at publish, not read at render, so a chapter that goes
 * live keeps the window it was given even if the operator changes the setting afterwards.
 * That only holds if the write actually happens — checked here against a real Postgres.
 */
let dir: string
let handle: DbHandle
let db: Db
let seriesId: number

const setSetting = async (key: string, value: unknown) => {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
}

const at = (mins: number, from: Date) => new Date(from.getTime() + mins * 60_000)

const addChapter = async (
  number: number,
  publishedAt: Date,
  earlyAccessUntil: Date | null = null,
) => {
  const [row] = await db
    .insert(chapters)
    .values({
      seriesId,
      number,
      state: 'scheduled',
      publishedAt,
      earlyAccessUntil,
      pageCount: 1,
    })
    .returning({ id: chapters.id })
  if (!row) throw new Error('insert returned nothing')
  return row.id
}

const read = async (id: number) => {
  const [row] = await db
    .select({ state: chapters.state, earlyAccessUntil: chapters.earlyAccessUntil })
    .from(chapters)
    .where(eq(chapters.id, id))
  if (!row) throw new Error(`chapter ${id} vanished`)
  return row
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'palscans-publish-'))
  handle = await createDb(`pglite://${path.join(dir, 'pg')}`)
  await runMigrations(handle)
  db = handle.db
  await db.insert(users).values({ email: 'e@e.test', username: 'e', role: 'user' })
  const [s] = await db
    .insert(series)
    .values({ slug: 'early-access-probe', title: 'Early Access Probe', type: 'manga' })
    .returning({ id: series.id })
  if (!s) throw new Error('series insert returned nothing')
  seriesId = s.id
})

afterAll(async () => {
  await handle.close()
  await rm(dir, { recursive: true, force: true })
})

describe('the early-access window at publish', () => {
  it('stamps the configured window on a chapter going live', async () => {
    const now = new Date('2026-09-04T12:00:00Z')
    await setSetting('entitlements', { early_access_minutes: 30 })
    const id = await addChapter(101, at(-1, now))
    expect(await publishDue(db, now)).toContain(id)
    const row = await read(id)
    expect(row.state).toBe('published')
    expect(row.earlyAccessUntil?.toISOString()).toBe(at(30, now).toISOString())
  })

  it('leaves a window the operator set by hand alone', async () => {
    const now = new Date('2026-09-04T13:00:00Z')
    const byHand = at(240, now)
    await setSetting('entitlements', { early_access_minutes: 30 })
    const id = await addChapter(102, at(-1, now), byHand)
    expect(await publishDue(db, now)).toContain(id)
    expect((await read(id)).earlyAccessUntil?.toISOString()).toBe(byHand.toISOString())
  })

  it('stamps nothing when the window is switched off', async () => {
    const now = new Date('2026-09-04T14:00:00Z')
    await setSetting('entitlements', { early_access_minutes: 0 })
    const id = await addChapter(103, at(-1, now))
    expect(await publishDue(db, now)).toContain(id)
    expect((await read(id)).earlyAccessUntil).toBe(null)
  })

  it('falls back to the shipped window when the setting has never been written', async () => {
    const now = new Date('2026-09-04T15:00:00Z')
    await setSetting('entitlements', {})
    const id = await addChapter(104, at(-1, now))
    expect(await publishDue(db, now)).toContain(id)
    expect((await read(id)).earlyAccessUntil?.toISOString()).toBe(
      at(DEFAULT_EARLY_ACCESS_MINUTES, now).toISOString(),
    )
  })

  it('leaves a chapter that is not due yet alone', async () => {
    const now = new Date('2026-09-04T16:00:00Z')
    await setSetting('entitlements', { early_access_minutes: 30 })
    const id = await addChapter(105, at(60, now))
    expect(await publishDue(db, now)).not.toContain(id)
    const row = await read(id)
    expect(row.state).toBe('scheduled')
    expect(row.earlyAccessUntil).toBe(null)
  })
})
