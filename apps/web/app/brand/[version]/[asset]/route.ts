import { getDb, getSetting } from '@palscans/db'
import { type IconAsset, iconVersion, isIconAsset } from '@/lib/chrome/icons'
import { renderIcon } from '@/lib/chrome/render-icon'
import { brandSettingSchema } from '@/lib/chrome/schema'

/**
 * `GET /brand/<version>/<asset>.png` — a favicon or PWA icon rendered from the uploaded
 * monogram (docs/15 "Favicon: generated from the monogram in every required size, including
 * maskable"). `lib/chrome/icons.ts` owns the sizes and the maskable safe zone.
 *
 * The `version` segment is a hash of the monogram key and background colour, so a URL's bytes
 * never change and the response can be `immutable` — no CDN purge on a logo change, and a
 * stale version simply 404s. A request for a version that is not current is refused rather
 * than served the new icon under the old URL, which would poison whatever cached it.
 *
 * Never prerendered: it reads a settings row, and the answer changes when the operator
 * uploads a new mark.
 */
export const dynamic = 'force-dynamic'

const notFound = () => Response.json({ error: 'not_found' }, { status: 404 })

export async function GET(_request: Request, ctx: RouteContext<'/brand/[version]/[asset]'>) {
  const { version, asset } = await ctx.params
  if (!isIconAsset(asset)) return notFound()

  let brand: ReturnType<typeof brandSettingSchema.parse>
  try {
    brand = brandSettingSchema.parse((await getSetting<unknown>(await getDb(), 'brand', {})) ?? {})
  } catch {
    return notFound()
  }
  if (iconVersion(brand) !== version) return notFound()

  let body: Uint8Array
  try {
    body = await renderIcon(brand, asset as IconAsset)
  } catch {
    // The object is gone, or is not an image sharp can read. A missing favicon is a 404, not
    // a 500 — a browser asking for an icon must never see a stack trace.
    return notFound()
  }

  return new Response(body as unknown as BodyInit, {
    headers: {
      'content-type': 'image/png',
      'content-length': String(body.byteLength),
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  })
}
