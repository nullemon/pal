import { describe, expect, it } from 'vitest'
import { downloadGalleryImage, resolveGallery } from '../fetch.js'
import { GalleryError } from '../types.js'

/**
 * The network half.
 *
 * `fetch` is injected, so what is under test is the policy rather than ImgChest: which URL
 * we build, what we do with a redirect, and what happens when a response is larger or
 * stranger than it should be. Those are the behaviours that keep a pasted link from becoming
 * a server-side request to somewhere else.
 */

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
])

const body = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })

interface Call {
  url: string
  headers: Record<string, string>
}

/** A fetch double that records calls and answers from a routing table. */
const fakeFetch = (
  routes: Record<
    string,
    {
      status?: number
      text?: string
      bytes?: Uint8Array
      finalUrl?: string
      headers?: Record<string, string>
    }
  >,
) => {
  const calls: Call[] = []
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
    const route = routes[url]
    if (!route) return new Response('nope', { status: 404 })
    const payload = route.bytes ?? new TextEncoder().encode(route.text ?? '')
    const response = new Response(body(payload), {
      status: route.status ?? 200,
      headers: route.headers ?? {},
    })
    // Response.url is read-only; redirects are simulated by overriding it.
    Object.defineProperty(response, 'url', { value: route.finalUrl ?? url })
    return response
  }) as typeof globalThis.fetch
  return { impl, calls }
}

const codeOf = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn()
  } catch (error) {
    return error instanceof GalleryError ? error.code : `threw ${String(error)}`
  }
  return 'did not resolve to an error'
}

const pageHtml = (files: unknown[]): string => {
  const json = JSON.stringify({
    props: { post: { slug: 'na7kjb9bq48', title: 'Ch 1', nsfw: 0, files } },
  })
  return `<div id="app" data-page="${json.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></div>`
}

const oneFile = [{ id: 'f1', link: 'https://cdn.imgchest.com/files/a.png', position: 1 }]

describe('resolveGallery', () => {
  it('builds the canonical gallery URL rather than re-using what was pasted', async () => {
    const { impl, calls } = fakeFetch({
      'https://imgchest.com/p/na7kjb9bq48': { text: pageHtml(oneFile) },
    })
    const post = await resolveGallery('http://WWW.imgchest.com/p/na7kjb9bq48?utm_source=whatever', {
      fetchImpl: impl,
    })
    expect(calls[0]?.url).toBe('https://imgchest.com/p/na7kjb9bq48')
    expect(post.images).toHaveLength(1)
  })

  it('needs no token for the default path', async () => {
    const { impl, calls } = fakeFetch({
      'https://imgchest.com/p/na7kjb9bq48': { text: pageHtml(oneFile) },
    })
    await resolveGallery('na7kjb9bq48', { fetchImpl: impl })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).not.toContain('api.imgchest.com')
  })

  it('prefers the API when a token is configured', async () => {
    const { impl, calls } = fakeFetch({
      'https://api.imgchest.com/v1/post/na7kjb9bq48': {
        text: JSON.stringify({
          data: { id: 'na7kjb9bq48', title: 'Ch 1', nsfw: 0, images: oneFile },
        }),
      },
    })
    const post = await resolveGallery('na7kjb9bq48', { fetchImpl: impl, token: 'tok' })
    expect(calls[0]?.url).toBe('https://api.imgchest.com/v1/post/na7kjb9bq48')
    expect(calls[0]?.headers.authorization).toBe('Bearer tok')
    expect(post.title).toBe('Ch 1')
  })

  it('falls back to the page when the token is rejected', async () => {
    // An expired token must not break imports that would have worked without one.
    const { impl, calls } = fakeFetch({
      'https://api.imgchest.com/v1/post/na7kjb9bq48': { status: 401, text: 'nope' },
      'https://imgchest.com/p/na7kjb9bq48': { text: pageHtml(oneFile) },
    })
    const post = await resolveGallery('na7kjb9bq48', { fetchImpl: impl, token: 'stale' })
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.imgchest.com/v1/post/na7kjb9bq48',
      'https://imgchest.com/p/na7kjb9bq48',
    ])
    expect(post.images).toHaveLength(1)
  })

  it('does not retry the page for a gallery that does not exist', async () => {
    const { impl, calls } = fakeFetch({
      'https://api.imgchest.com/v1/post/na7kjb9bq48': { status: 404 },
    })
    expect(await codeOf(() => resolveGallery('na7kjb9bq48', { fetchImpl: impl, token: 't' }))).toBe(
      'not_found',
    )
    expect(calls).toHaveLength(1)
  })

  it('reports a bad link without making a request', async () => {
    const { impl, calls } = fakeFetch({})
    expect(
      await codeOf(() => resolveGallery('https://evil.example/p/na7kjb9bq48', { fetchImpl: impl })),
    ).toBe('bad_url')
    expect(calls).toHaveLength(0)
  })

  it('surfaces rate limiting as its own code', async () => {
    const { impl } = fakeFetch({ 'https://imgchest.com/p/na7kjb9bq48': { status: 429 } })
    expect(await codeOf(() => resolveGallery('na7kjb9bq48', { fetchImpl: impl }))).toBe(
      'rate_limited',
    )
  })

  it('refuses a gallery page that redirected off the host', async () => {
    // An allowlist applied only to the URL we send is defeated by a 302 to anywhere.
    const { impl } = fakeFetch({
      'https://imgchest.com/p/na7kjb9bq48': {
        text: pageHtml(oneFile),
        finalUrl: 'https://evil.example/p/na7kjb9bq48',
      },
    })
    expect(await codeOf(() => resolveGallery('na7kjb9bq48', { fetchImpl: impl }))).toBe(
      'bad_image_host',
    )
  })
})

describe('downloadGalleryImage', () => {
  it('returns the sniffed type, not the declared one', async () => {
    const { impl } = fakeFetch({
      'https://cdn.imgchest.com/files/a.png': {
        bytes: PNG,
        headers: { 'content-type': 'image/jpeg' },
      },
    })
    const out = await downloadGalleryImage('https://cdn.imgchest.com/files/a.png', {
      fetchImpl: impl,
      maxBytes: 1024,
    })
    expect(out.type).toBe('image/png')
    expect(out.bytes).toHaveLength(PNG.length)
  })

  it('refuses bytes that are not an image at all', async () => {
    const { impl } = fakeFetch({
      'https://cdn.imgchest.com/files/a.png': {
        bytes: new TextEncoder().encode('<!doctype html><html>a login page</html>'),
      },
    })
    expect(
      await codeOf(() =>
        downloadGalleryImage('https://cdn.imgchest.com/files/a.png', {
          fetchImpl: impl,
          maxBytes: 1024,
        }),
      ),
    ).toBe('not_an_image')
  })

  it('refuses an off-host image URL before fetching it', async () => {
    const { impl, calls } = fakeFetch({})
    expect(
      await codeOf(() =>
        downloadGalleryImage('http://169.254.169.254/latest/meta-data/', {
          fetchImpl: impl,
          maxBytes: 1024,
        }),
      ),
    ).toBe('bad_image_host')
    expect(calls).toHaveLength(0)
  })

  it('refuses an image that redirects off the host', async () => {
    const { impl } = fakeFetch({
      'https://cdn.imgchest.com/files/a.png': {
        bytes: PNG,
        finalUrl: 'http://127.0.0.1:6379/',
      },
    })
    expect(
      await codeOf(() =>
        downloadGalleryImage('https://cdn.imgchest.com/files/a.png', {
          fetchImpl: impl,
          maxBytes: 1024,
        }),
      ),
    ).toBe('bad_image_host')
  })

  it('rejects an oversized body up front when Content-Length says so', async () => {
    const { impl } = fakeFetch({
      'https://cdn.imgchest.com/files/a.png': {
        bytes: PNG,
        headers: { 'content-length': '99999999' },
      },
    })
    expect(
      await codeOf(() =>
        downloadGalleryImage('https://cdn.imgchest.com/files/a.png', {
          fetchImpl: impl,
          maxBytes: 1024,
        }),
      ),
    ).toBe('too_large')
  })

  it('still stops an oversized body that declared no length', async () => {
    // Content-Length is a claim. The cap has to hold while reading, or a lying server
    // decides how much memory a 2 GB worker allocates.
    const { impl } = fakeFetch({
      'https://cdn.imgchest.com/files/a.png': { bytes: new Uint8Array(4096) },
    })
    expect(
      await codeOf(() =>
        downloadGalleryImage('https://cdn.imgchest.com/files/a.png', {
          fetchImpl: impl,
          maxBytes: 1024,
        }),
      ),
    ).toBe('too_large')
  })
})
