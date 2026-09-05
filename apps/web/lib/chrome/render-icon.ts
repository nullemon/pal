import 'server-only'
import sharp from 'sharp'
import { getStorage } from '@/lib/storage'
import { ICON_ASSETS, type IconAsset, markOwnsContainer, SOCIAL_CARD } from './icons'
import { LOGO_PRESET_ART } from './preset-art'
import type { BrandSetting } from './schema'

/**
 * The rasteriser behind `/brand/<version>/<asset>` (docs/15 "Favicon").
 *
 * Split from `./icons.ts` on purpose: that module is imported by the root layout's metadata
 * and by the manifest, and it must not drag `sharp` — a native binary — into their module
 * graph for the sake of a few pure functions.
 */

/** The maskable safe zone: the middle 80% of the square survives every launcher's mask. */
const SAFE_ZONE = 0.8

const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const n = Number.parseInt(m?.[1] ?? '100d17', 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/**
 * The bytes of whichever mark is in force: the chosen preset's SVG, or the uploaded monogram.
 * Null when neither is set — the caller answers 404 and the shipped icons stay in use.
 */
const markSource = async (brand: BrandSetting): Promise<Uint8Array | null> => {
  if (brand.logo_preset) {
    const art = LOGO_PRESET_ART[brand.logo_preset]
    return art ? new Uint8Array(Buffer.from(art, 'utf8')) : null
  }
  if (!brand.monogram) return null
  const storage = await getStorage()
  return (await storage.get(brand.monogram.key)) ?? null
}

/** Render one size from the mark in force. Throws if there is nothing to render. */
export async function renderIcon(brand: BrandSetting, asset: IconAsset): Promise<Uint8Array> {
  const source = await markSource(brand)
  if (!source) throw new Error('monogram missing')

  const { size, kind } = ICON_ASSETS[asset]
  const bg = hexToRgb(brand.monogram_bg)
  // `density` only matters for SVG input: it is the DPI librsvg rasterises at, and the
  // default 72 turns a 512pt mark into a blurry 512px one when asked for 512 device pixels.
  const full = sharp(Buffer.from(source), { density: 384 })

  if (kind === 'social') {
    // The default share card (docs/15 "1200×630 used when a page has no better OG image"):
    // the mark centred on the brand square. No text — the site name is a setting, and drawing
    // it would mean shipping a font into the rasteriser for a fallback image.
    const inner = Math.round(SOCIAL_CARD.height * 0.6)
    const mark = await full
      .resize(inner, inner, { fit: 'contain', background: { ...bg, alpha: 0 } })
      .png()
      .toBuffer()
    return new Uint8Array(
      await sharp({
        create: {
          width: SOCIAL_CARD.width,
          height: SOCIAL_CARD.height,
          channels: 4,
          background: { ...bg, alpha: 1 },
        },
      })
        .composite([{ input: mark, gravity: 'centre' }])
        .png()
        .toBuffer(),
    )
  }

  // A mark that draws its own tile or disc already fills the frame; insetting it would put a
  // border round a border, and its own container is what the launcher's mask should bite into.
  const inset = kind === 'maskable' && !markOwnsContainer(brand)
  const inner = inset ? Math.round(size * SAFE_ZONE) : size
  const mark = await full
    .resize(inner, inner, { fit: 'contain', background: { ...bg, alpha: 0 } })
    .png()
    .toBuffer()

  if (kind === 'any') return new Uint8Array(mark)

  const pad = Math.round((size - inner) / 2)
  return new Uint8Array(
    await sharp({
      create: { width: size, height: size, channels: 4, background: { ...bg, alpha: 1 } },
    })
      .composite([{ input: mark, top: pad, left: pad }])
      .png()
      .toBuffer(),
  )
}
