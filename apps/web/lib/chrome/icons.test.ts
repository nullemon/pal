import { describe, expect, it, vi } from 'vitest'
import { brandSettingSchema } from './schema'

/**
 * Icon generation (docs/15 "Favicon: generated from the monogram in every required size,
 * including maskable").
 *
 * The rasteriser is exercised for real — sharp, from an SVG, to PNG bytes — because the
 * things most likely to be wrong are the ones a mock would paper over: the output size, and
 * whether a maskable icon is actually opaque.
 */

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" rx="128" fill="#ffffff"/></svg>`

const state = vi.hoisted(() => ({ body: null as Uint8Array | null }))

vi.mock('@/lib/storage', () => ({
  getStorage: async () => ({ get: async () => state.body }),
}))

const brand = (over: Record<string, unknown> = {}) =>
  brandSettingSchema.parse({
    monogram: { key: 'brand/monogram-abc123abc123.svg', width: 512, height: 512 },
    monogram_bg: '#123456',
    ...over,
  })

describe('iconVersion', () => {
  it('is null until a monogram is uploaded, so the shipped icons stay in use', async () => {
    const { iconVersion } = await import('./icons')
    expect(iconVersion(brandSettingSchema.parse({}))).toBeNull()
  })

  it('is null until a logo is chosen, preset or upload', async () => {
    const { iconVersion } = await import('./icons')
    expect(iconVersion(brandSettingSchema.parse({ logo_preset: null }))).toBeNull()
  })

  it('changes when the mark or its background changes, and not otherwise', async () => {
    const { iconVersion } = await import('./icons')
    const a = iconVersion(brand())
    expect(a).toBe(iconVersion(brand()))
    expect(a).not.toBe(iconVersion(brand({ monogram_bg: '#654321' })))
    expect(a).not.toBe(
      iconVersion(
        brand({ monogram: { key: 'brand/monogram-999999999999.svg', width: 8, height: 8 } }),
      ),
    )
  })
})

describe('isIconAsset', () => {
  it('accepts only the assets it names', async () => {
    const { isIconAsset } = await import('./icons')
    expect(isIconAsset('icon-192.png')).toBe(true)
    expect(isIconAsset('social.png')).toBe(true)
    expect(isIconAsset('icon-999.png')).toBe(false)
    // The route segment is user input, so an inherited property must not slip through.
    expect(isIconAsset('toString')).toBe(false)
    expect(isIconAsset('__proto__')).toBe(false)
  })
})

describe('iconSet', () => {
  it('offers the uploaded SVG itself as a favicon, but only when it is an SVG', async () => {
    const { iconSet } = await import('./icons')
    const svg = iconSet(
      brand({
        monogram: {
          key: 'brand/monogram-abc123abc123.svg',
          width: 512,
          height: 512,
          type: 'image/svg+xml',
        },
      }),
      (k) => `/_storage/${k}`,
    )
    expect(svg?.svgUrl).toBe('/_storage/brand/monogram-abc123abc123.svg')
    const png = iconSet(
      brand({
        monogram: {
          key: 'brand/monogram-abc123abc123.png',
          width: 512,
          height: 512,
          type: 'image/png',
        },
      }),
      (k) => `/_storage/${k}`,
    )
    expect(png?.svgUrl).toBeNull()
  })
})

describe('renderIcon', () => {
  it('renders each size as a PNG of exactly that size', async () => {
    state.body = new Uint8Array(Buffer.from(SVG))
    const { renderIcon } = await import('./render-icon')
    const sharp = (await import('sharp')).default
    for (const [asset, size] of [
      ['icon-32.png', 32],
      ['icon-192.png', 192],
      ['maskable-512.png', 512],
      ['apple-touch-icon.png', 180],
    ] as const) {
      const out = await renderIcon(brand(), asset)
      const meta = await sharp(Buffer.from(out)).metadata()
      expect([asset, meta.format, meta.width, meta.height]).toEqual([asset, 'png', size, size])
    }
  })

  it('fills a maskable icon to the edges with the chosen background', async () => {
    state.body = new Uint8Array(Buffer.from(SVG))
    const { renderIcon } = await import('./render-icon')
    const sharp = (await import('sharp')).default
    const out = await renderIcon(brand(), 'maskable-192.png')
    const { data, info } = await sharp(Buffer.from(out)).raw().toBuffer({ resolveWithObject: true })
    // Top-left is outside the safe zone: it must be the background colour, fully opaque.
    expect([data[0], data[1], data[2]]).toEqual([0x12, 0x34, 0x56])
    if (info.channels === 4) expect(data[3]).toBe(255)
    // The centre is the mark itself (white in the fixture).
    const mid =
      (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels
    expect(data[mid]).toBe(255)
  })

  it('leaves an ordinary icon transparent outside the mark', async () => {
    state.body = new Uint8Array(Buffer.from(SVG))
    const { renderIcon } = await import('./render-icon')
    const sharp = (await import('sharp')).default
    const out = await renderIcon(brand(), 'icon-192.png')
    const { data, info } = await sharp(Buffer.from(out))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    // The fixture is a rounded square, so the very corner falls outside its radius.
    expect(data[info.channels - 1]).toBe(0)
  })

  it('refuses rather than throws when the object has gone', async () => {
    state.body = null
    const { renderIcon } = await import('./render-icon')
    await expect(renderIcon(brand(), 'icon-32.png')).rejects.toThrow('monogram missing')
  })
})

/**
 * The picker (docs/15 "Logo"): choosing one of the ten directions has to reach the favicon and
 * the PWA icons, not just the header — which means the rasteriser reads the preset's own art
 * and never touches storage.
 */
describe('a chosen logo direction', () => {
  const preset = (id: string) =>
    brandSettingSchema.parse({ logo_preset: id, monogram_bg: '#123456' })

  it('gives the site a generated icon set without any upload', async () => {
    const { iconSet, iconVersion } = await import('./icons')
    const set = iconSet(preset('03-twin-bookmark'), (k) => `/_storage/${k}`)
    expect(set?.version).toBe(iconVersion(preset('03-twin-bookmark')))
    // The mark is inlined into the page, so there is no SVG URL to hand a browser.
    expect(set?.svgUrl).toBeNull()
    expect(set?.social).toBe(true)
  })

  it('renders every size from the preset, with storage never consulted', async () => {
    state.body = null // any storage read would fail
    const { renderIcon } = await import('./render-icon')
    const sharp = (await import('sharp')).default
    const out = await renderIcon(preset('03-twin-bookmark'), 'icon-192.png')
    const meta = await sharp(Buffer.from(out)).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 192, 192])
  })

  it('renders the 1200x630 share card', async () => {
    state.body = null
    const { renderIcon } = await import('./render-icon')
    const sharp = (await import('sharp')).default
    const out = await renderIcon(preset('03-twin-bookmark'), 'social.png')
    const meta = await sharp(Buffer.from(out)).metadata()
    expect([meta.width, meta.height]).toEqual([1200, 630])
  })

  /**
   * 01, 05 and 06 draw their own tile or disc. Insetting those into the maskable safe zone
   * would put a border around a border, so they are rendered full-bleed: their own container
   * is what the launcher's mask bites into.
   */
  it('renders a container-owning mark full-bleed and a free-standing one inset', async () => {
    state.body = null
    const { renderIcon } = await import('./render-icon')
    const sharp = (await import('sharp')).default
    // Sampled at the middle of the left edge, not the corner: 01's tile is a rounded square,
    // so its actual corner is outside the shape either way and would prove nothing.
    const edgeOf = async (id: string) => {
      const out = await renderIcon(preset(id), 'maskable-192.png')
      const { data, info } = await sharp(Buffer.from(out))
        .raw()
        .toBuffer({ resolveWithObject: true })
      const at = Math.floor(info.height / 2) * info.width * info.channels
      return [data[at], data[at + 1], data[at + 2]]
    }
    // Free-standing: the mark is inset, so the frame is the chosen background all round.
    expect(await edgeOf('03-twin-bookmark')).toEqual([0x12, 0x34, 0x56])
    // Container-owning: the mark's own purple tile reaches the edge instead.
    expect(await edgeOf('01-panel-cut')).toEqual([0x7c, 0x3a, 0xed])
  })
})
