import { describe, expect, it } from 'vitest'
import { streamGalleryImage } from '../fetch.js'
import { GalleryError } from '../types.js'

/**
 * Streaming a page image through the reader proxy instead of buffering it.
 *
 * The buffered version held an entire image in the heap for the length of its download, with
 * nothing bounding how many did so at once. What has to survive the change is everything
 * that made buffering safe: the host allowlist, the byte cap, and the refusal to believe the
 * host's `Content-Type`. The cap is the subtle one — it used to be checked while filling a
 * buffer, and now has to be enforced against a stream that is already flowing.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]

/** A PNG signature followed by filler, so `sniffImage` has something real to read. */
const png = (bytes: number): Uint8Array => {
  const out = new Uint8Array(bytes)
  out.set(PNG_SIGNATURE.slice(0, Math.min(PNG_SIGNATURE.length, bytes)), 0)
  for (let i = PNG_SIGNATURE.length; i < bytes; i++) out[i] = i % 251
  return out
}

/** Serve `body` in fixed-size chunks, the way a real host dribbles a response out. */
const serve = (body: Uint8Array, opts: { chunk?: number; contentLength?: number | null } = {}) => {
  const chunk = opts.chunk ?? 8
  let offset = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= body.byteLength) {
        controller.close()
        return
      }
      controller.enqueue(body.slice(offset, offset + chunk))
      offset += chunk
    },
  })
  const headers = new Headers()
  const declared = opts.contentLength === undefined ? body.byteLength : opts.contentLength
  if (declared !== null) headers.set('content-length', String(declared))
  return (async () => {
    const response = new Response(stream, { status: 200, headers })
    Object.defineProperty(response, 'url', { value: 'https://cdn.imgchest.com/files/p1.png' })
    return response
  }) as unknown as typeof globalThis.fetch
}

const drain = async (body: ReadableStream<Uint8Array>): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      total += value.byteLength
    }
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.byteLength
  }
  return out
}

const URL_OK = 'https://cdn.imgchest.com/files/p1.png'

const codeOf = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn()
  } catch (error) {
    return error instanceof GalleryError ? error.code : `threw ${String(error)}`
  }
  return 'did not throw'
}

describe('streamGalleryImage', () => {
  it('delivers every byte, in order, including the ones used to identify it', async () => {
    // The sniff has to read the header before anything can be sent; forgetting to re-emit
    // those bytes produces an image missing its first bytes, which decodes as nothing.
    const source = png(400)
    const { type, body } = await streamGalleryImage(URL_OK, {
      maxBytes: 1_000_000,
      fetchImpl: serve(source),
    })
    expect(type).toBe('image/png')
    expect(await drain(body)).toEqual(source)
  })

  it('identifies the type from the bytes, not from what the host claims', async () => {
    const { type } = await streamGalleryImage(URL_OK, {
      maxBytes: 1_000_000,
      fetchImpl: serve(png(64)),
    })
    expect(type).toBe('image/png')
  })

  it('refuses something that is not an image', async () => {
    const notAnImage = new TextEncoder().encode('<!doctype html><html>nope</html>')
    expect(
      await codeOf(() =>
        streamGalleryImage(URL_OK, { maxBytes: 1_000_000, fetchImpl: serve(notAnImage) }),
      ),
    ).toBe('not_an_image')
  })

  it('refuses a declared length over the cap before reading anything', async () => {
    expect(
      await codeOf(() =>
        streamGalleryImage(URL_OK, {
          maxBytes: 100,
          fetchImpl: serve(png(64), { contentLength: 10_000 }),
        }),
      ),
    ).toBe('too_large')
  })

  it('enforces the cap mid-stream when the host declared no length', async () => {
    // The case buffering caught by filling a buffer: a host that says nothing and keeps
    // sending. The stream has to notice as the bytes arrive.
    const { body } = await streamGalleryImage(URL_OK, {
      maxBytes: 100,
      fetchImpl: serve(png(5_000), { contentLength: null }),
    })
    await expect(drain(body)).rejects.toThrow()
  })

  it('enforces the cap mid-stream when the host lied about the length', async () => {
    const { body } = await streamGalleryImage(URL_OK, {
      maxBytes: 100,
      fetchImpl: serve(png(5_000), { contentLength: 50 }),
    })
    await expect(drain(body)).rejects.toThrow()
  })

  it('still refuses a private address, which is the guard that matters most', async () => {
    for (const url of [
      'http://127.0.0.1/p.png',
      'http://169.254.169.254/latest/meta-data',
      'http://10.0.0.5/p.png',
    ])
      expect(
        await codeOf(() =>
          streamGalleryImage(url, { maxBytes: 1_000_000, fetchImpl: serve(png(64)) }),
        ),
        url,
      ).toBe('bad_image_host')
  })

  it('handles a host that closes before sending enough to identify', async () => {
    expect(
      await codeOf(() =>
        streamGalleryImage(URL_OK, { maxBytes: 1_000_000, fetchImpl: serve(png(4)) }),
      ),
    ).toBe('not_an_image')
  })
})
