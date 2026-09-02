import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { z } from 'zod'
import { getEnv } from '@/lib/env'
import { resolveFsRoot } from '@/lib/storage'

/**
 * Local storage host for the `fs` storage driver. Exposed at `/_storage/*` through the
 * rewrite in next.config.ts. Serves nothing unless STORAGE_DRIVER=fs, so a production
 * deployment on S3/R2 never leaks the filesystem.
 *
 * Failures are `{ error: 'not_found' }` (docs/16: every route handler returns `{ data }` or
 * `{ error }`); the success case streams the file body itself.
 */

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

export async function GET(_request: Request, ctx: RouteContext<'/api/storage/[...path]'>) {
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
      // Uploaded objects are content-addressed by the worker, so long caching is safe.
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      // Files are served from the site origin; an SVG (or anything else) opened directly
      // must never run script or load resources as this origin.
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  })
}
