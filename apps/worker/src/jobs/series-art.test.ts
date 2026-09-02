import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { artKey, encodeArt } from './series-art.js'

const photo = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 40, g: 90, b: 200 } } })
    .jpeg({ quality: 80 })
    .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'secret-marker' } } })
    .toBuffer()

describe('series.art', () => {
  it('re-encodes a cover into the docs/03 widths, oriented and stripped of metadata', async () => {
    const encoded = await encodeArt(new Uint8Array(await photo(1000, 1500)), 'cover', 'solo', {
      avifEffort: 0,
    })
    // orientation 6 rotates 90°: the stored image is 1500 wide
    expect(encoded.width).toBe(1500)
    expect(encoded.height).toBe(1000)
    expect(encoded.variants.map((v) => `${v.w}.${v.fmt}`)).toEqual([
      '200.webp',
      '200.avif',
      '400.webp',
      '400.avif',
      '800.webp',
      '800.avif',
    ])
    expect(encoded.primaryKey).toBe(artKey('cover', 'solo', encoded.sha, 800, 'webp'))
    expect(encoded.primaryKey).toMatch(/^covers\/solo\/[a-f0-9]{12}\.800\.webp$/)
    const largest = encoded.variants.find((v) => v.key === encoded.primaryKey)
    if (!largest) throw new Error('no primary variant')
    const meta = await sharp(largest.data).metadata()
    expect(meta.width).toBe(800)
    expect(meta.exif).toBeUndefined()
    expect(meta.orientation).toBeUndefined()
    expect(largest.data.includes(Buffer.from('secret-marker'))).toBe(false)
  })

  it('never upscales a small banner and refuses non-images', async () => {
    const small = await encodeArt(new Uint8Array(await photo(600, 300)), 'banner', 'x', {
      avifEffort: 0,
    })
    expect(small.variants.map((v) => v.w)).toEqual([300, 300])
    await expect(
      encodeArt(new TextEncoder().encode('<svg onload=alert(1)/>'), 'cover', 'x'),
    ).rejects.toThrow()
  })
})
