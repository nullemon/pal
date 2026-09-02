import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { chapterLock } from '@palscans/core'
import { chapters, getDb } from '@palscans/db'
import { and, eq, isNull } from 'drizzle-orm'
import { unstable_cache } from 'next/cache'
import { z } from 'zod'
import { getEnv } from '@/lib/env'
import { resolveFsRoot, verifyStorageGetSignature } from '@/lib/storage'

/**
 * Local storage host for the `fs` storage driver. Exposed at `/_storage/*` through the
 * rewrite in next.config.ts. Serves nothing unless STORAGE_DRIVER=fs, so a production
 * deployment on S3/R2 never leaks the filesystem.
 *
 * Pages of a locked chapter (`pages/<seriesId>/<chapterId>/…`, the keys the worker writes)
 * are the fs equivalent of a private object: they are served only with a valid `exp` +
 * `sig` from `signedStorageUrl` and never cached (docs/03 "Paid content").
 *
 * Failures are `{ error: 'not_found' }` (docs/16: every route handler returns `{ data }` or
 * `{ error }`); the success case streams the file body itself.
 */

const chapterAccessRow = unstable_cache(
  async (chapterId: number) => {
    const db = await getDb()
    const [row] = await db
      .select({
        state: chapters.state,
        isPremium: chapters.isPremium,
        earlyAccessUntil: chapters.earlyAccessUntil,
      })
      .from(chapters)
      .where(and(eq(chapters.id, chapterId), isNull(chapters.deletedAt)))
      .limit(1)
    return row
      ? {
          state: row.state,
          isPremium: row.isPremium,
          earlyAccessUntil: row.earlyAccessUntil ? row.earlyAccessUntil.toISOString() : null,
        }
      : null
  },
  ['storage', 'chapter-access'],
  { revalidate: 60, tags: ['catalog'] },
)

/** True when the key is a page of a chapter the public may not read (unknown chapter → locked). */
const isLockedPage = async (segments: string[], now: Date): Promise<boolean> => {
  if (segments[0] !== 'pages' || segments.length < 4) return false
  if (!/^\d+$/.test(segments[1] ?? '') || !/^\d+$/.test(segments[2] ?? '')) return false
  const row = await chapterAccessRow(Number(segments[2]))
  if (!row) return true
  const lock = chapterLock(
    {
      state: row.state,
      is_premium: row.isPremium,
      early_access_until: row.earlyAccessUntil ? new Date(row.earlyAccessUntil) : null,
    },
    now,
  )
  return lock !== 'none'
}

const contentTypes: Record<string, string> = {
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
}

/** One non-empty path segment: no separators, no NUL. Checked raw and again after decoding. */
const segment = z
  .string()
  .min(1)
  .regex(/^[^\\/\0]+$/)
const paramsSchema = z.object({ path: z.array(segment).min(1) })

const notFound = () => Response.json({ error: 'not_found' }, { status: 404 })
const forbidden = () =>
  Response.json({ error: 'forbidden' }, { status: 403, headers: { 'cache-control': 'no-store' } })

export async function GET(request: Request, ctx: RouteContext<'/api/storage/[...path]'>) {
  const env = getEnv()
  if (env.STORAGE_DRIVER !== 'fs') return notFound()

  const parsed = paramsSchema.safeParse(await ctx.params)
  if (!parsed.success) return notFound()

  let segments: string[]
  try {
    // Malformed percent-encoding throws URIError; that is a 404, not a 500.
    segments = parsed.data.path.map(decodeURIComponent)
  } catch {
    return notFound()
  }
  if (!segments.every((s) => segment.safeParse(s).success)) return notFound()

  const locked = await isLockedPage(segments, new Date())
  if (locked) {
    const q = new URL(request.url).searchParams
    const exp = Number(q.get('exp'))
    const sig = q.get('sig') ?? ''
    if (!/^[a-f0-9]{64}$/.test(sig) || !verifyStorageGetSignature(sig, segments.join('/'), exp))
      return forbidden()
  }

  // The root comes from env at runtime and, like the fs driver that writes the files, a
  // relative STORAGE_FS_ROOT is anchored at the workspace root (not apps/web).
  const root = resolveFsRoot(env.STORAGE_FS_ROOT)
  const target = path.resolve(/* turbopackIgnore: true */ root, ...segments)
  if (target !== root && !target.startsWith(root + path.sep)) return notFound()

  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(target)
  } catch {
    return notFound()
  }
  if (!info.isFile()) return notFound()

  const ext = path.extname(target).toLowerCase()
  const type = contentTypes[ext] ?? 'application/octet-stream'
  const stream = Readable.toWeb(createReadStream(target)) as ReadableStream
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': type,
      'content-length': String(info.size),
      'last-modified': info.mtime.toUTCString(),
      // Uploaded objects are content-addressed by the worker, so long caching is safe —
      // except locked pages, whose signed URLs must stop working when they expire.
      'cache-control': locked ? 'private, no-store' : 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      // Files are served from the site origin; an SVG (or anything else) opened directly
      // must never run script or load resources as this origin.
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  })
}
