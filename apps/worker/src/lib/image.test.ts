import { normalizeWatermark, type WatermarkConfig } from '@palscans/core/watermark'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  pageAddress,
  processImage,
  segmentsFor,
  variantKey,
  watermarkFontAvailable,
  watermarkOverlay,
  widthsFor,
} from './image.js'

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 120, g: 60, b: 200 } } })
    .jpeg({ quality: 80 })
    .toBuffer()

const mark = (over: Partial<WatermarkConfig> = {}): WatermarkConfig =>
  normalizeWatermark({ enabled: true, text: 'palscans.org', ...over })

interface Box {
  left: number
  top: number
  width: number
  height: number
}

const rawOf = (image: Buffer | Uint8Array, box: Box) =>
  sharp(image).extract(box).removeAlpha().raw().toBuffer()

/**
 * Mean absolute pixel difference between two encodes of the same page inside one box.
 *
 * Measuring the *difference* rather than the brightness is what makes the assertion honest:
 * the mark is a white body inside a black halo, so on dark art it can lower the average of
 * a region as easily as raise it. What it can never do is leave the pixels alone.
 */
const diffIn = async (a: Buffer | Uint8Array, b: Buffer | Uint8Array, box: Box) => {
  const [x, y] = await Promise.all([rawOf(a, box), rawOf(b, box)])
  let total = 0
  for (let i = 0; i < x.length; i++) total += Math.abs((x[i] ?? 0) - (y[i] ?? 0))
  return total / x.length
}

describe('image pipeline', () => {
  it('only downscales', () => {
    expect(widthsFor(2000)).toEqual([480, 720, 1080, 1440])
    expect(widthsFor(800)).toEqual([480, 720])
    expect(widthsFor(300)).toEqual([300])
  })

  it('splits long strips into ≤ 5000px segments and leaves short pages alone', () => {
    expect(segmentsFor(1500)).toEqual([{ top: 0, height: 1500 }])
    const segs = segmentsFor(12_000)
    expect(segs.length).toBe(3)
    expect(segs.every((s) => s.height <= 5000)).toBe(true)
    expect(segs.reduce((n, s) => n + s.height, 0)).toBe(12_000)
    expect(segs[1]?.top).toBe(4000)
  })

  it('encodes avif + webp variants with content-addressed keys and a blurhash', async () => {
    const pages = await processImage(new Uint8Array(await solid(800, 1200)), {
      prefix: 'pages/1/2',
      startIdx: 3,
      avifEffort: 0,
    })
    expect(pages).toHaveLength(1)
    const p = pages[0]
    if (!p) throw new Error('no page')
    expect(p.width).toBe(800)
    expect(p.height).toBe(1200)
    expect(p.blurHash).toMatch(/^[\w#$%*+,\-.:;=?@[\]^{|}~]+$/)
    expect(p.variants.map((v) => `${v.w}.${v.fmt}`)).toEqual([
      '480.webp',
      '480.avif',
      '720.webp',
      '720.avif',
    ])
    expect(p.variants[0]?.key).toBe(variantKey('pages/1/2', 3, p.sha, 480, 'webp'))
    expect(p.variants.every((v) => v.bytes > 0 && v.data.byteLength === v.bytes)).toBe(true)
  }, 30_000)

  it('emits consecutive pages for a long strip', async () => {
    const pages = await processImage(new Uint8Array(await solid(400, 10_500)), {
      prefix: 'pages/1/2',
      startIdx: 0,
      avifEffort: 0,
    })
    expect(pages.length).toBe(3)
    expect(pages.reduce((n, p) => n + p.height, 0)).toBe(10_500)
    expect(pages[0]?.variants[0]?.key.startsWith('pages/1/2/0000-')).toBe(true)
    expect(pages[2]?.variants[0]?.key.startsWith('pages/1/2/0002-')).toBe(true)
  }, 60_000)

  it('folds the watermark into the content address so a changed mark cannot reuse a key', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5])
    const plain = pageAddress(bytes)
    expect(pageAddress(bytes, null)).toBe(plain)
    expect(pageAddress(bytes, normalizeWatermark({ enabled: false }))).toBe(plain)
    const marked = pageAddress(bytes, mark())
    expect(marked).not.toBe(plain)
    expect(pageAddress(bytes, mark())).toBe(marked)
    expect(pageAddress(bytes, mark({ corner: 'bottom-left' }))).not.toBe(marked)
    expect(pageAddress(bytes, mark({ text: 'elsewhere.org' }))).not.toBe(marked)
    expect(pageAddress(bytes, mark({ opacity: 0.9 }))).not.toBe(marked)
  })

  it('builds a corner band, not a page-sized overlay, and pins it with a gravity', () => {
    const overlay = watermarkOverlay(1440, 2160, mark({ corner: 'bottom-right' }))
    if (!overlay) throw new Error('expected an overlay')
    expect(overlay.gravity).toBe('south')
    const svg = String(overlay.input)
    expect(svg).toContain('width="1440"')
    expect(svg).toContain('text-anchor="end"')
    expect(watermarkOverlay(40, 40, mark())).toBeNull()
  })

  it('has a font to draw with in this environment', async () => {
    expect(await watermarkFontAvailable()).toBe(true)
  })

  it('burns the mark into every width, in the requested corner only', async () => {
    const source = new Uint8Array(
      await sharp({ create: { width: 1500, height: 2200, channels: 3, background: '#101018' } })
        .png()
        .toBuffer(),
    )
    const config = mark({ corner: 'top-right', scale: 3, opacity: 1 })
    const [plain] = await processImage(source, { prefix: 'p', startIdx: 0, avifEffort: 0 })
    const [marked] = await processImage(source, {
      prefix: 'p',
      startIdx: 0,
      avifEffort: 0,
      watermark: config,
    })
    if (!plain || !marked) throw new Error('no page')
    expect(marked.sha).not.toBe(plain.sha)

    for (const width of [480, 720, 1080, 1440]) {
      const before = plain.variants.find((v) => v.w === width && v.fmt === 'webp')
      const after = marked.variants.find((v) => v.w === width && v.fmt === 'webp')
      if (!before || !after) throw new Error(`no ${width} variant`)
      // The chosen corner carries the mark at every width, not only the largest…
      const corner = {
        left: Math.round(width * 0.5),
        top: 0,
        width: Math.round(width * 0.5) - 1,
        height: Math.round(width * 0.12),
      }
      expect(await diffIn(after.data, before.data, corner)).toBeGreaterThan(2)
      // …and the far corner of the same page is untouched.
      const far = { ...corner, left: 0, top: Math.round(width * 1.2) }
      expect(await diffIn(after.data, before.data, far)).toBeLessThan(0.5)
    }
  }, 120_000)

  it('leaves the pixels and the key alone when the mark is switched off', async () => {
    const source = new Uint8Array(await solid(800, 1200))
    const [plain] = await processImage(source, { prefix: 'p', startIdx: 0, avifEffort: 0 })
    const [off] = await processImage(source, {
      prefix: 'p',
      startIdx: 0,
      avifEffort: 0,
      watermark: normalizeWatermark({ enabled: false }),
    })
    if (!plain || !off) throw new Error('no page')
    expect(off.sha).toBe(plain.sha)
    expect(off.variants[0]?.data.equals(plain.variants[0]?.data as Buffer)).toBe(true)
  }, 60_000)

  it('marks every segment of a long strip, not just the first', async () => {
    const pages = await processImage(new Uint8Array(await solid(600, 10_500)), {
      prefix: 'p',
      startIdx: 0,
      avifEffort: 0,
      watermark: mark({ opacity: 1, scale: 4 }),
    })
    const plain = await processImage(new Uint8Array(await solid(600, 10_500)), {
      prefix: 'p',
      startIdx: 0,
      avifEffort: 0,
    })
    expect(pages).toHaveLength(3)
    for (const [i, page] of pages.entries()) {
      expect(page.sha).not.toBe(plain[i]?.sha)
    }
  }, 120_000)

  it('rejects undecodable input', async () => {
    await expect(
      processImage(new Uint8Array([1, 2, 3, 4]), { prefix: 'pages/1/2', startIdx: 0 }),
    ).rejects.toThrow()
  })
})
