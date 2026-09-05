import { WATERMARK_DEFAULTS, watermarkFingerprint } from '@palscans/core/watermark'
import { chapters, createDb, type Db, type DbHandle, runMigrations, series } from '@palscans/db'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { reapplyChapter, UPLOAD_PREFIX } from './watermark-reapply'

/**
 * The one mistake in this feature that cannot be undone: compositing the mark onto an image
 * that already carries one. Output objects are content-addressed and served `immutable`, so
 * a double-marked page is not a bug you fix — it is a page you re-upload.
 *
 * The structural guarantee is that the job's only byte source is the uploaded original under
 * `uploads/`, never the processed page under `pages/`. Asserted here from the outside, with a
 * storage spy on a chapter whose recorded sources have been poisoned to name processed pages
 * — the shape a corrupted row, or a refactor that "helpfully" reused the page keys, would
 * have. The outcome must be a refusal *and* zero reads.
 */
let handle: DbHandle
let db: Db
let chapterId = 0

beforeAll(async () => {
  handle = await createDb('pglite://memory')
  await runMigrations(handle)
  db = handle.db
  const [s] = await db
    .insert(series)
    .values({ slug: 'mark-probe', title: 'Mark Probe', type: 'manga', state: 'published' })
    .returning({ id: series.id })
  if (!s) throw new Error('series not inserted')
  const [c] = await db
    .insert(chapters)
    .values({
      seriesId: s.id,
      number: 1,
      state: 'published',
      pageCount: 1,
      // Poisoned: these name already-marked output objects, not uploaded originals.
      processing: {
        sources: [
          {
            idx: 0,
            key: `pages/${s.id}/999/0000-abc123.1080.webp`,
            bytes: 3,
            sha256: 'abc123',
          },
        ],
        progress: { done: 1, total: 1 },
        errors: {},
        attempt: 1,
        startedAt: '2026-09-01T00:00:00.000Z',
        finishedAt: '2026-09-01T00:00:01.000Z',
      },
    })
    .returning({ id: chapters.id })
  if (!c) throw new Error('chapter not inserted')
  chapterId = c.id
}, 180_000)

afterAll(async () => {
  await handle.close()
})

it('refuses a chapter whose sources are processed pages, without reading a byte', async () => {
  const reads: string[] = []
  const storage = {
    get: vi.fn(async (key: string) => {
      reads.push(key)
      return new Uint8Array([1, 2, 3])
    }),
    put: vi.fn(async () => undefined),
    head: vi.fn(async (key: string) => {
      reads.push(key)
      return { size: 3 }
    }),
    delete: vi.fn(async () => undefined),
  }
  const mark = { ...WATERMARK_DEFAULTS, enabled: true, text: 'palscans.org' }
  const outcome = await reapplyChapter(chapterId, mark, watermarkFingerprint(mark), {
    db,
    storage: storage as never,
  })

  expect(outcome.status, JSON.stringify(outcome)).toBe('skipped')
  expect(outcome.reason).toBe('foreign_sources')
  expect(reads, 'not one byte was touched').toEqual([])
  expect(storage.put, 'nothing was written').not.toHaveBeenCalled()
})

it('accepts only the uploads prefix, so the guard cannot silently widen', () => {
  expect(UPLOAD_PREFIX).toBe('uploads/')
  for (const notAnOriginal of [
    'pages/1/1/0000-abc.1080.webp',
    'covers/1.webp',
    '../uploads/1/1/0.jpg',
    'my-uploads/1/1/0.jpg',
    '/uploads/1/1/0.jpg',
  ])
    expect(notAnOriginal.startsWith(UPLOAD_PREFIX), notAnOriginal).toBe(false)
})
