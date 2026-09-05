import { describe, expect, it } from 'vitest'
import { DEFAULT_CHROME, isActive, splitWordmark } from './site'

describe('site defaults', () => {
  it('has the header links from the spec in order', () => {
    expect(DEFAULT_CHROME.header.map((l) => l.label)).toEqual([
      'Home',
      'Browse',
      'Rankings',
      'Genres',
      'Bookmarks',
    ])
  })

  /**
   * The header nav used to be `hidden md:block` with no mobile equivalent at all. If a
   * default ever arrives flagged for the phone, an untouched site grows a row it never had.
   */
  it('flags no header link for the mobile strip', () => {
    expect(DEFAULT_CHROME.header.every((l) => l.mobile === false)).toBe(true)
  })

  it('has three link columns and five social networks', () => {
    expect(DEFAULT_CHROME.footer.map((c) => c.title)).toEqual(['Browse', 'Account', 'Legal'])
    expect(DEFAULT_CHROME.community.socials).toHaveLength(5)
    expect(DEFAULT_CHROME.community.support).toEqual([])
    expect(DEFAULT_CHROME.community.rss).toBe(false)
  })

  it('has the four shipped bottom-nav tabs', () => {
    expect(DEFAULT_CHROME.bottomNav.map((i) => i.id)).toEqual([
      'home',
      'browse',
      'bookmarks',
      'profile',
    ])
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

describe('wordmark split', () => {
  it('keeps the two weights of the shipped name', () => {
    expect(splitWordmark('PALScans')).toEqual(['PAL', 'Scans'])
  })

  it('leaves a name with no acronym prefix in one piece', () => {
    expect(splitWordmark('Toonily')).toEqual(['Toonily', ''])
    expect(splitWordmark('Manga Hub')).toEqual(['Manga Hub', ''])
    // A single leading capital is not an acronym — "MangaHub" is one word, not M + angaHub.
    expect(splitWordmark('MangaHub')).toEqual(['MangaHub', ''])
  })

  it('splits other acronym prefixes the same way', () => {
    expect(splitWordmark('ABCReads')).toEqual(['ABC', 'Reads'])
  })
})
