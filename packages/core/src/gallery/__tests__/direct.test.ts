import { describe, expect, it } from 'vitest'
import { parseDirectList } from '../direct.js'
import { GalleryError } from '../types.js'

/** A chapter from pasted URLs — the escape hatch for hosts we will never adapt to. */

const codeOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (error) {
    return error instanceof GalleryError ? error.code : `threw ${String(error)}`
  }
  return 'did not throw'
}

describe('parseDirectList', () => {
  it('keeps the order the lines were given in', () => {
    // Never sorted. The operator typed the lines, so the lines are the page order; sorting
    // them would be the worst thing this function could do.
    const post = parseDirectList(`
      https://cdn.example.com/10.jpg
      https://cdn.example.com/2.jpg
      https://cdn.example.com/1.jpg
    `)
    expect(post.images.map((i) => i.link)).toEqual([
      'https://cdn.example.com/10.jpg',
      'https://cdn.example.com/2.jpg',
      'https://cdn.example.com/1.jpg',
    ])
    expect(post.images.map((i) => i.position)).toEqual([1, 2, 3])
  })

  it('tolerates the noise people paste alongside URLs', () => {
    const post = parseDirectList(
      ['- https://cdn.example.com/1.jpg', '2. https://cdn.example.com/2.jpg', '', '  '].join('\n'),
    )
    expect(post.images).toHaveLength(2)
  })

  it('refuses a repeated URL instead of quietly dropping it', () => {
    // Almost always a paste that went wrong, and the two plausible intentions have opposite
    // right answers — so it asks rather than guesses.
    expect(codeOf(() => parseDirectList('https://a.example/1.jpg\nhttps://a.example/1.jpg'))).toBe(
      'bad_url',
    )
  })

  it('refuses a private or loopback target', () => {
    expect(codeOf(() => parseDirectList('https://a.example/1.jpg\nhttp://127.0.0.1:5432/'))).toBe(
      'bad_image_host',
    )
  })

  it('refuses an empty list and an over-long one', () => {
    expect(codeOf(() => parseDirectList('   \n  '))).toBe('empty')
    expect(
      codeOf(() =>
        parseDirectList(
          Array.from({ length: 401 }, (_, i) => `https://a.example/${i}.jpg`).join('\n'),
        ),
      ),
    ).toBe('too_many')
  })

  it('names the offending line, because a 200-line paste needs it', () => {
    try {
      parseDirectList('https://a.example/1.jpg\nhttps://a.example/2.jpg\nnonsense')
    } catch (error) {
      expect((error as GalleryError).message).toContain('line 3')
    }
  })
})
