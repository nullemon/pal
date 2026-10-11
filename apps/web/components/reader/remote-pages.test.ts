import { describe, expect, it, vi } from 'vitest'

/**
 * How a page that lives on another host reaches the reader.
 *
 * The rule has two halves and only one of them is about speed:
 *
 * - A **free** chapter is served straight from the host. The proxy hop costs a round trip
 *   through our origin — a one-core box — and on a cache miss it is slower than the host it
 *   is hiding. For a page anyone may read, that buys nothing.
 * - A **locked** chapter is not, ever. A `cdn.imgchest.com` URL in the markup is readable by
 *   anyone who views source, so handing one out for a premium page is the paywall gone. This
 *   is the half worth a test, because the failure is silent: the pages still render, and
 *   nothing says the chapter stopped being locked.
 */

// `storageUrl` is defined in data.ts itself and reads the config mirror, so only the two
// real module boundaries are stubbed: the signer and the config install.
vi.mock('@/lib/storage', () => ({
  signedStorageUrl: async (key: string) => `https://img.example.test/${key}?sig=x`,
}))
vi.mock('@/lib/config/install', () => ({ ensureConfig: async () => undefined }))
vi.mock('@/lib/config/mirror', () => ({
  configMirror: () => ({ driver: 's3', cdnUrl: 'https://img.example.test' }),
  cdnBase: () => 'https://img.example.test',
}))

const { toReaderPages } = await import('./server/data')

const page = (over: Record<string, unknown> = {}) => ({
  chapterId: 7,
  idx: 0,
  key: 'remote:abc123.png',
  remoteUrl: 'https://cdn.imgchest.com/files/abc123.png',
  width: 800,
  height: 1200,
  blurHash: null,
  variants: [],
  ...over,
})

describe('a remote page', () => {
  it('is served straight from the host when the chapter is free', async () => {
    const [out] = await toReaderPages([page()], 'none')
    expect(out?.url).toBe('https://cdn.imgchest.com/files/abc123.png')
  })

  it('goes through our proxy when the chapter is premium', async () => {
    const [out] = await toReaderPages([page()], 'premium')
    expect(out?.url).toBe('/p/7/0')
    expect(out?.url).not.toContain('imgchest')
  })

  it('goes through our proxy during early access', async () => {
    const [out] = await toReaderPages([page()], 'early_access')
    expect(out?.url).toBe('/p/7/0')
    expect(out?.url).not.toContain('imgchest')
  })

  it('goes through our proxy while unpublished', async () => {
    const [out] = await toReaderPages([page()], 'unpublished')
    expect(out?.url).toBe('/p/7/0')
  })

  it('never offers variants, because nothing was encoded', async () => {
    // A srcset here would be three copies of one URL, which is worse than none.
    const [out] = await toReaderPages([page()], 'none')
    expect(out?.variants).toEqual([])
  })

  it('keeps the intrinsic size, so the reader still lays out without jumping', async () => {
    const [out] = await toReaderPages([page()], 'none')
    expect(out?.width).toBe(800)
    expect(out?.height).toBe(1200)
  })
})

describe('a stored page is untouched by any of this', () => {
  it('still resolves to our own storage when free', async () => {
    const [out] = await toReaderPages(
      [page({ remoteUrl: null, key: 'pages/1/2/0000.webp' })],
      'none',
    )
    expect(out?.url).toBe('https://img.example.test/pages/1/2/0000.webp')
  })

  it('still gets a signed URL when locked', async () => {
    const [out] = await toReaderPages(
      [page({ remoteUrl: null, key: 'pages/1/2/0000.webp' })],
      'premium',
    )
    expect(out?.url).toContain('sig=')
  })
})
