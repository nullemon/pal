import { describe, expect, it } from 'vitest'
import { footerColumns, headerNav, isActive, socialLinks } from './site'

describe('site config', () => {
  it('has the header links from the spec in order', () => {
    expect(headerNav.map((l) => l.label)).toEqual([
      'Home',
      'Browse',
      'Rankings',
      'Genres',
      'Bookmarks',
    ])
  })

  it('has three link columns and five social networks', () => {
    expect(footerColumns.map((c) => c.title)).toEqual(['Browse', 'Account', 'Legal'])
    expect(socialLinks).toHaveLength(5)
  })

  it('matches active links exactly or by prefix', () => {
    expect(isActive('/', { label: 'Home', href: '/' })).toBe(true)
    expect(isActive('/browse', { label: 'Home', href: '/' })).toBe(false)
    expect(isActive('/genres/action', { label: 'Genres', href: '/genres', prefix: true })).toBe(
      true,
    )
    expect(isActive('/genres/action', { label: 'Genres', href: '/genres' })).toBe(false)
  })
})
