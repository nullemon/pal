import {
  normalizeWatermark,
  WATERMARK_CORNERS,
  watermarkGeometry,
  watermarkSvg,
} from '@palscans/core/watermark'
import { chapterPages, chapters, getDb } from '@palscans/db'
import { and, desc, eq, isNotNull, isNull, type SQL } from 'drizzle-orm'
import sharp from 'sharp'
import { z } from 'zod'
import { fail, parseQuery, withPermission } from '@/lib/auth'
import { getStorage } from '@/lib/storage'

/** Widths the pipeline emits (docs/03) — the preview only ever shows one of them. */
const WIDTHS = [480, 720, 1080, 1440] as const

const schema = z.object({
  width: z.coerce
    .number()
    .int()
    .refine((w): w is (typeof WIDTHS)[number] => (WIDTHS as readonly number[]).includes(w)),
  text: z.string().min(1).max(64),
  corner: z.enum(WATERMARK_CORNERS),
  scale: z.coerce.number(),
  margin: z.coerce.number(),
  opacity: z.coerce.number(),
  view: z.enum(['corner', 'page']).default('corner'),
  tone: z.enum(['dark', 'light']).default('dark'),
})

/**
 * A real page to draw on. The *source* upload is preferred over the processed variant: if
 * the chapter was already processed with a watermark, previewing on its output would show
 * two marks and flatter the settings. Both can be gone (originals pruned, nothing uploaded
 * yet), so there is a generated fallback and the preview always renders something.
 */
const samplePage = async (): Promise<Buffer | null> => {
  const db = await getDb()
  const firstPage = async (extra?: SQL | undefined) =>
    db
      .select({ processing: chapters.processing, key: chapterPages.key })
      .from(chapters)
      .innerJoin(
        chapterPages,
        and(eq(chapterPages.chapterId, chapters.id), eq(chapterPages.idx, 0)),
      )
      .where(and(eq(chapters.state, 'published'), isNull(chapters.deletedAt), extra))
      .orderBy(desc(chapters.publishedAt))
      .limit(1)
  // A chapter that actually went through the pipeline first: it has a source upload to
  // draw on, which is real artwork rather than an imported placeholder.
  const [preferred] = await firstPage(isNotNull(chapters.processing))
  const row = preferred ?? (await firstPage())[0]
  if (!row) return null
  const storage = await getStorage()
  const source = row.processing?.sources?.find((s) => s.idx === 0)?.key
  for (const key of [source, row.key]) {
    if (!key) continue
    const bytes = await storage.get(key).catch(() => null)
    if (bytes) return Buffer.from(bytes)
  }
  return null
}

/** Two-tone artwork so a fresh install with nothing uploaded still gets a usable preview. */
const generatedSample = async (width: number): Promise<Buffer> => {
  const height = Math.round(width * 1.5)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#10131f"/><stop offset="0.55" stop-color="#3b4468"/><stop offset="1" stop-color="#e9e4d8"/></linearGradient></defs><rect width="${width}" height="${height}" fill="url(#g)"/><ellipse cx="${width * 0.5}" cy="${height * 0.45}" rx="${width * 0.3}" ry="${height * 0.14}" fill="#ffffff"/><rect x="0" y="${height * 0.72}" width="${width}" height="${height * 0.28}" fill="#000000"/></svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

/**
 * GET /api/admin/appearance/watermark/preview — the composite the pipeline would write,
 * rendered from the same geometry and SVG the worker uses.
 *
 * It is the honest answer to "what will this look like": the settings are not saved yet,
 * nothing is written to storage, and the pixels come out of the exact code path
 * `chapter.process` runs. It also fails visibly rather than silently when the host has no
 * font for the mark — the preview simply comes back unmarked, which is what the operator
 * needs to see.
 */
export const GET = withPermission('settings.write', async (request) => {
  const parsed = parseQuery(request, schema)
  if (!parsed.ok) return parsed.response
  const q = parsed.data
  const config = normalizeWatermark({ ...q, enabled: true })

  let source = await samplePage().catch(() => null)
  if (!source) source = await generatedSample(1440)

  try {
    let base = sharp(source).rotate()
    if (q.tone === 'light') base = sharp(await base.negate({ alpha: false }).png().toBuffer())
    const resized = await base
      .resize({ width: q.width, withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true })
    const { width, height } = resized.info
    const geometry = watermarkGeometry(width, height, config)
    const marked = geometry
      ? await sharp(resized.data)
          .composite([{ input: Buffer.from(watermarkSvg(geometry)), gravity: geometry.gravity }])
          .png()
          .toBuffer()
      : resized.data

    // The corner view crops to twice the band so the mark is legible in a settings panel
    // without the operator having to zoom into a full page.
    let out = marked
    if (q.view === 'corner' && geometry) {
      const cropHeight = Math.min(height, geometry.height * 2)
      out = await sharp(marked)
        .extract({
          left: 0,
          top: geometry.gravity === 'north' ? 0 : height - cropHeight,
          width,
          height: cropHeight,
        })
        .png()
        .toBuffer()
    }
    return new Response(new Uint8Array(out), {
      headers: {
        'content-type': 'image/png',
        'cache-control': 'private, no-store',
        'content-length': String(out.byteLength),
      },
    })
  } catch {
    return fail(500, 'preview_failed')
  }
})
