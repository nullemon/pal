import { describe, expect, it } from 'vitest'
import {
  isValidSlug,
  MAX_SLUG_LENGTH,
  parseSuffix,
  slugify,
  uniqueSlug,
  withSuffix,
} from '../slug.js'

describe('slugify', () => {
  it('lowercases, hyphenates, strips diacritics and punctuation', () => {
    expect(slugify('Return of the Frost Monarch')).toBe('return-of-the-frost-monarch')
    expect(slugify('The Villainess Keeps the Receipts!')).toBe('the-villainess-keeps-the-receipts')
    expect(slugify('  Café — Été   2024 ')).toBe('cafe-ete-2024')
    expect(slugify("Solo Leveler's Ragnarök")).toBe('solo-levelers-ragnarok')
    expect(slugify('Tom & Jerry')).toBe('tom-and-jerry')
    expect(slugify('Ch. 12.5')).toBe('ch-12-5')
  })
  it('falls back for non-ASCII-only titles', () => {
    expect(slugify('서리 군주의 귀환')).toBe('untitled')
    expect(slugify('서리 군주의 귀환', { fallback: 'series' })).toBe('series')
  })
  it('caps length at a boundary', () => {
    const long = `${'a'.repeat(50)} ${'b'.repeat(50)}`
    const s = slugify(long)
    expect(s.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH)
    expect(s.endsWith('-')).toBe(false)
    expect(isValidSlug(s)).toBe(true)
  })
})

describe('uniqueSlug', () => {
  it('adds a -2, -3 suffix on collision', () => {
    expect(uniqueSlug('Overgrowth', [])).toBe('overgrowth')
    expect(uniqueSlug('Overgrowth', ['overgrowth'])).toBe('overgrowth-2')
    expect(uniqueSlug('Overgrowth', ['overgrowth', 'overgrowth-2'])).toBe('overgrowth-3')
    expect(uniqueSlug('Overgrowth', ['OVERGROWTH'])).toBe('overgrowth-2')
  })
  it('keeps suffixed slugs within the max length', () => {
    const root = 'x'.repeat(MAX_SLUG_LENGTH)
    expect(withSuffix(root, 12).length).toBeLessThanOrEqual(MAX_SLUG_LENGTH)
    expect(withSuffix(root, 12).endsWith('-12')).toBe(true)
  })
  it('parses suffixes', () => {
    expect(parseSuffix('overgrowth-3')).toEqual({ root: 'overgrowth', n: 3 })
    expect(parseSuffix('overgrowth')).toEqual({ root: 'overgrowth', n: 1 })
    expect(parseSuffix('area-51')).toEqual({ root: 'area', n: 51 })
    expect(parseSuffix('chapter-1')).toEqual({ root: 'chapter-1', n: 1 })
  })
  it('validates', () => {
    expect(isValidSlug('frost-monarch')).toBe(true)
    expect(isValidSlug('Frost Monarch')).toBe(false)
    expect(isValidSlug('-frost')).toBe(false)
    expect(isValidSlug('frost--monarch')).toBe(false)
  })
})
