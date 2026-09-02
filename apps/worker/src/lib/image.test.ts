import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { processImage, segmentsFor, variantKey, widthsFor } from './image.js'

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 120, g: 60, b: 200 } } })
    .jpeg({ quality: 80 })
    .toBuffer()

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

  it('rejects undecodable input', async () => {
    await expect(
      processImage(new Uint8Array([1, 2, 3, 4]), { prefix: 'pages/1/2', startIdx: 0 }),
    ).rejects.toThrow()
  })
})
