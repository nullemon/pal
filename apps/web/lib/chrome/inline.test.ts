import { describe, expect, it } from 'vitest'
import { parseInline, plainInline, safeHref } from './inline'

/**
 * The announcement bar renders operator copy on every page of the site. The grammar is tiny
 * on purpose; what these assert is that everything outside it stays *text*.
 */

describe('safeHref', () => {
  it('accepts site paths and absolute http(s) URLs', () => {
    expect(safeHref('/browse')).toEqual({ href: '/browse', external: false })
    expect(safeHref('#main')).toEqual({ href: '#main', external: false })
    expect(safeHref('https://example.com/x')).toEqual({
      href: 'https://example.com/x',
      external: true,
    })
  })

  it('refuses script, data and scheme-relative targets', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('JavaScript:alert(1)')).toBeNull()
    expect(safeHref('data:text/html,<script>')).toBeNull()
    expect(safeHref('//evil.example')).toBeNull()
    expect(safeHref('')).toBeNull()
  })
})

describe('parseInline', () => {
  it('leaves plain text alone', () => {
    expect(parseInline('Server move on Sunday')).toEqual([
      { kind: 'text', text: 'Server move on Sunday' },
    ])
  })

  it('reads bold, italic and links', () => {
    expect(parseInline('**Now** in *beta* — [read more](/announcements)')).toEqual([
      { kind: 'strong', text: 'Now' },
      { kind: 'text', text: ' in ' },
      { kind: 'em', text: 'beta' },
      { kind: 'text', text: ' — ' },
      { kind: 'link', text: 'read more', href: '/announcements', external: false },
    ])
  })

  it('prefers bold over italic at the same offset', () => {
    expect(parseInline('**both**')).toEqual([{ kind: 'strong', text: 'both' }])
  })

  it('keeps an unsafe link as literal text rather than dropping it', () => {
    expect(parseInline('[click](javascript:alert(1))')).toEqual([
      { kind: 'text', text: '[click](javascript:alert(1)' },
      { kind: 'text', text: ')' },
    ])
  })

  it('never produces markup from HTML — it is text, and React escapes it', () => {
    const nodes = parseInline('<script>alert(1)</script>')
    expect(nodes).toEqual([{ kind: 'text', text: '<script>alert(1)</script>' }])
  })

  it('degrades an unclosed marker to text', () => {
    expect(parseInline('**not closed')).toEqual([{ kind: 'text', text: '**not closed' }])
  })

  it('strips markup for the plain-text form', () => {
    expect(plainInline('**Now** in *beta* — [read more](/x)')).toBe('Now in beta — read more')
  })
})
