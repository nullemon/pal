import { plainText } from '@palscans/core/comments'
import { describe, expect, it } from 'vitest'
import { bodyToMarkup, parseInline, parseMarkup } from '../markup'

describe('parseMarkup', () => {
  it('splits paragraphs and keeps line breaks', () => {
    const body = parseMarkup('first line\nsecond line\n\nnext paragraph')
    expect(body.children).toHaveLength(2)
    expect(body.children[0]).toMatchObject({ type: 'paragraph' })
    expect(plainText(body)).toBe('first line\nsecond line\n\nnext paragraph')
  })

  it('parses bold, italic, strike and spoilers', () => {
    const nodes = parseInline('a **bold** and *it* and ~~gone~~ then ||secret||')
    expect(nodes).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'text', text: 'bold', marks: ['bold'] },
      { type: 'text', text: ' and ' },
      { type: 'text', text: 'it', marks: ['italic'] },
      { type: 'text', text: ' and ' },
      { type: 'text', text: 'gone', marks: ['strike'] },
      { type: 'text', text: ' then ' },
      { type: 'spoiler', children: [{ type: 'text', text: 'secret' }] },
    ])
  })

  it('leaves unmatched delimiters as text', () => {
    expect(parseInline('2 * 3 = 6 and **oops')).toEqual([
      { type: 'text', text: '2 * 3 = 6 and **oops' },
    ])
  })

  it('turns @names into mentions and URLs into links', () => {
    const nodes = parseInline('@noctis same read, see https://palscans.org/x.')
    expect(nodes[0]).toEqual({ type: 'mention', username: 'noctis' })
    const link = nodes.find((n) => n.type === 'link')
    expect(link).toMatchObject({ type: 'link', href: 'https://palscans.org/x' })
    expect(nodes.at(-1)).toEqual({ type: 'text', text: '.' })
  })

  it('does not treat emails as mentions', () => {
    expect(parseInline('mail me@example')).toEqual([{ type: 'text', text: 'mail me@example' }])
  })

  it('appends an image block when an image is attached', () => {
    const body = parseMarkup('nice', { imageId: 7 })
    expect(body.children.at(-1)).toEqual({ type: 'image', imageId: 7 })
  })

  it('round-trips through bodyToMarkup', () => {
    const text = 'Hello **world** with ||a secret|| and @kael\n\nSecond ~~para~~'
    const body = parseMarkup(text, { imageId: 3 })
    const back = bodyToMarkup(body)
    expect(back.text).toBe(text)
    expect(back.imageId).toBe(3)
  })
})
