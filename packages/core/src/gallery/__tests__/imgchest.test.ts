import { describe, expect, it } from 'vitest'
import {
  IMGCHEST_ID,
  isImgchestHost,
  parseImgchestApi,
  parseImgchestId,
  parseImgchestPage,
} from '../imgchest.js'
import { GalleryError } from '../types.js'

/**
 * The ImgChest parsers.
 *
 * Shapes here are taken from two existing clients rather than invented — gallery-dl's
 * `imagechest` extractor and the `imgchest-rs` models agree that the gallery page carries
 * the post as escaped JSON in `#app[data-page]`, with the images under `props.post.files`,
 * and that the API answers `{ data: { images: [...] } }`. Both call the per-image URL `link`
 * and number positions from 1.
 */

/** Build a gallery page the way ImgChest serves one: the JSON escaped into an attribute. */
const page = (post: unknown, { quote = '"' } = {}): string => {
  const json = JSON.stringify({ props: { post } })
  const escaped = json.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  return `<!doctype html><html><body><div id="app" data-page=${quote}${escaped}${quote}></div></body></html>`
}

const file = (n: number, over: Record<string, unknown> = {}) => ({
  id: `f${n}`,
  description: null,
  link: `https://cdn.imgchest.com/files/page${n}.jpg`,
  position: n,
  ...over,
})

const post = (over: Record<string, unknown> = {}) => ({
  slug: 'na7kjb9bq48',
  title: 'Chapter 12',
  nsfw: 0,
  views: 41,
  user: { username: 'someone' },
  files: [file(1), file(2), file(3)],
  ...over,
})

const codeOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (error) {
    return error instanceof GalleryError ? error.code : `threw ${String(error)}`
  }
  return 'did not throw'
}

describe('parseImgchestId', () => {
  it('takes the forms an operator actually pastes', () => {
    for (const input of [
      'https://imgchest.com/p/na7kjb9bq48',
      'http://imgchest.com/p/na7kjb9bq48',
      'https://www.imgchest.com/p/na7kjb9bq48',
      'imgchest.com/p/na7kjb9bq48',
      '  https://imgchest.com/p/na7kjb9bq48  ',
      'https://imgchest.com/p/na7kjb9bq48?utm_source=x',
      'https://imgchest.com/p/na7kjb9bq48#top',
      'https://imgchest.com/p/na7kjb9bq48/',
      'na7kjb9bq48',
    ])
      expect(parseImgchestId(input), input).toBe('na7kjb9bq48')
  })

  it('refuses the same path on another host', () => {
    // The path shape is not the credential. Accepting this would hand an operator a way to
    // make the server fetch an arbitrary origin.
    expect(parseImgchestId('https://evil.example/p/na7kjb9bq48')).toBeNull()
  })

  it('refuses a host that merely ends in the right letters', () => {
    expect(parseImgchestId('https://evilimgchest.com/p/na7kjb9bq48')).toBeNull()
    expect(parseImgchestId('https://imgchest.com.evil.example/p/na7kjb9bq48')).toBeNull()
  })

  it('refuses credentials that make the real host a userinfo prefix', () => {
    // `new URL` reports evil.example as the hostname here, which is what a fetch would
    // connect to. Matching on the raw string instead would accept it.
    expect(parseImgchestId('https://imgchest.com@evil.example/p/na7kjb9bq48')).toBeNull()
  })

  it('refuses non-http schemes', () => {
    for (const input of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html,hi',
      'ftp://imgchest.com/p/na7kjb9bq48',
    ])
      expect(parseImgchestId(input), input).toBeNull()
  })

  it('refuses ids of the wrong shape', () => {
    for (const input of [
      'https://imgchest.com/p/short',
      'https://imgchest.com/p/na7kjb9bq48extra',
      'https://imgchest.com/p/na7kjb9bq4-',
      'https://imgchest.com/u/someone',
      'https://imgchest.com/',
      '',
      '   ',
    ])
      expect(parseImgchestId(input), input).toBeNull()
  })

  it('accepts exactly eleven alphanumerics as a bare id', () => {
    expect(IMGCHEST_ID.test('na7kjb9bq48')).toBe(true)
    expect(IMGCHEST_ID.test('na7kjb9bq4')).toBe(false)
    expect(IMGCHEST_ID.test('na7kjb9bq481')).toBe(false)
  })
})

describe('isImgchestHost', () => {
  it('accepts the apex, subdomains, and a trailing dot', () => {
    for (const host of [
      'imgchest.com',
      'IMGCHEST.COM',
      'cdn.imgchest.com',
      'api.imgchest.com',
      'imgchest.com.',
    ])
      expect(isImgchestHost(host), host).toBe(true)
  })

  it('rejects lookalikes and anything else', () => {
    for (const host of [
      'evilimgchest.com',
      'imgchest.com.evil.example',
      'localhost',
      '169.254.169.254',
      '127.0.0.1',
      '',
    ])
      expect(isImgchestHost(host), host).toBe(false)
  })
})

describe('parseImgchestPage', () => {
  it('reads the images out of the escaped data-page attribute', () => {
    const result = parseImgchestPage(page(post()), 'na7kjb9bq48')
    expect(result.provider).toBe('imgchest')
    expect(result.id).toBe('na7kjb9bq48')
    expect(result.title).toBe('Chapter 12')
    expect(result.nsfw).toBe(false)
    expect(result.images.map((i) => i.link)).toEqual([
      'https://cdn.imgchest.com/files/page1.jpg',
      'https://cdn.imgchest.com/files/page2.jpg',
      'https://cdn.imgchest.com/files/page3.jpg',
    ])
  })

  it('handles a single-quoted attribute', () => {
    const result = parseImgchestPage(page(post(), { quote: "'" }), 'na7kjb9bq48')
    expect(result.images).toHaveLength(3)
  })

  it('survives a title containing escaped quotes and ampersands', () => {
    // The unescaping has to be one pass: a two-pass version turns a literal `&amp;quot;`
    // into a real quote and corrupts the JSON.
    const result = parseImgchestPage(
      page(post({ title: 'Ch. 5 "Blue" & \'Red\' &amp;quot; <b>' })),
      'na7kjb9bq48',
    )
    expect(result.title).toBe('Ch. 5 "Blue" & \'Red\' &amp;quot; <b>')
    expect(result.images).toHaveLength(3)
  })

  it('orders by position when positions are sound', () => {
    const shuffled = post({ files: [file(3), file(1), file(2)] })
    expect(parseImgchestPage(page(shuffled), 'na7kjb9bq48').images.map((i) => i.position)).toEqual([
      1, 2, 3,
    ])
  })

  it('keeps document order when positions are duplicated', () => {
    // A wrongly ordered chapter is worse than one that trusted the array it was handed, so
    // an untrustworthy `position` is ignored rather than sorted on.
    const broken = post({
      files: [file(1, { position: 1 }), file(2, { position: 1 }), file(3, { position: 1 })],
    })
    expect(parseImgchestPage(page(broken), 'na7kjb9bq48').images.map((i) => i.link)).toEqual([
      'https://cdn.imgchest.com/files/page1.jpg',
      'https://cdn.imgchest.com/files/page2.jpg',
      'https://cdn.imgchest.com/files/page3.jpg',
    ])
  })

  it('numbers positions from the array when they are missing entirely', () => {
    const noPos = post({
      files: [file(1, { position: undefined }), file(2, { position: undefined })],
    })
    expect(parseImgchestPage(page(noPos), 'na7kjb9bq48').images.map((i) => i.position)).toEqual([
      1, 2,
    ])
  })

  it('reads nsfw as the 0/1 it actually arrives as', () => {
    expect(parseImgchestPage(page(post({ nsfw: 1 })), 'x').nsfw).toBe(true)
    expect(parseImgchestPage(page(post({ nsfw: 0 })), 'x').nsfw).toBe(false)
  })

  it('aborts the whole import on an off-host image link', () => {
    // Not skipped: a chapter quietly missing page 2 is a worse outcome than a refusal, and
    // this is also the SSRF boundary — the worker fetches these URLs server-side.
    const hostile = post({
      files: [file(1), file(2, { link: 'http://169.254.169.254/latest/meta-data/' }), file(3)],
    })
    expect(codeOf(() => parseImgchestPage(page(hostile), 'x'))).toBe('bad_image_host')
  })

  it('refuses a non-http image link', () => {
    const hostile = post({ files: [file(1, { link: 'file:///etc/passwd' })] })
    expect(codeOf(() => parseImgchestPage(page(hostile), 'x'))).toBe('bad_image_host')
  })

  it('distinguishes a missing gallery from a broken parser', () => {
    // ImgChest answers an unknown gallery with 200 and a Not Found page, so without this the
    // operator's typo and our own bug produce the same message.
    expect(codeOf(() => parseImgchestPage('<html><title>Not Found</title></html>', 'x'))).toBe(
      'not_found',
    )
    expect(codeOf(() => parseImgchestPage('<html><body>redesigned</body></html>', 'x'))).toBe(
      'unparseable',
    )
  })

  it('reports an empty gallery as empty', () => {
    expect(codeOf(() => parseImgchestPage(page(post({ files: [] })), 'x'))).toBe('empty')
  })

  it('refuses a gallery past the page ceiling', () => {
    const many = post({ files: Array.from({ length: 401 }, (_, i) => file(i + 1)) })
    expect(codeOf(() => parseImgchestPage(page(many), 'x'))).toBe('too_many')
  })

  it('reports malformed JSON as unparseable, not as empty', () => {
    expect(codeOf(() => parseImgchestPage('<div data-page="{not json}"></div>', 'x'))).toBe(
      'unparseable',
    )
  })

  it('falls back to the requested id when the post carries no slug', () => {
    expect(parseImgchestPage(page(post({ slug: undefined })), 'na7kjb9bq48').id).toBe('na7kjb9bq48')
  })
})

describe('parseImgchestApi', () => {
  it('reads the data envelope and the images key', () => {
    // The API differs from the scraped page in exactly one way that matters: `images`
    // instead of `files`.
    const body = {
      data: {
        id: 'na7kjb9bq48',
        title: 'Chapter 12',
        nsfw: 0,
        image_count: 2,
        images: [file(1), file(2)],
      },
    }
    const result = parseImgchestApi(body, 'na7kjb9bq48')
    expect(result.title).toBe('Chapter 12')
    expect(result.images.map((i) => i.link)).toEqual([
      'https://cdn.imgchest.com/files/page1.jpg',
      'https://cdn.imgchest.com/files/page2.jpg',
    ])
  })

  it('applies the same host rule as the scraped path', () => {
    const body = { data: { images: [file(1, { link: 'https://evil.example/x.jpg' })] } }
    expect(codeOf(() => parseImgchestApi(body, 'x'))).toBe('bad_image_host')
  })

  it('reports a missing envelope rather than crashing', () => {
    expect(codeOf(() => parseImgchestApi({ nope: true }, 'x'))).toBe('unparseable')
    expect(codeOf(() => parseImgchestApi(null, 'x'))).toBe('unparseable')
  })
})
