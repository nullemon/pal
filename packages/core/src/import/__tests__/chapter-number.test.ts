import { describe, expect, it } from 'vitest'
import { isUnparsedChapterName, parseChapterNumber } from '../chapter-number.js'

describe('parseChapterNumber', () => {
  it('parses the forms docs/09 calls out', () => {
    expect(parseChapterNumber('Chapter 12.5')).toEqual({
      number: '12.5',
      title: null,
      volume: null,
    })
    expect(parseChapterNumber('Ch.7 - The End')).toEqual({
      number: '7',
      title: 'The End',
      volume: null,
    })
    expect(parseChapterNumber('Vol.2 Ch.3')).toEqual({ number: '3', title: null, volume: 2 })
    expect(parseChapterNumber('154')).toEqual({ number: '154', title: null, volume: null })
    expect(parseChapterNumber('Chapter 301: Title')).toEqual({
      number: '301',
      title: 'Title',
      volume: null,
    })
  })

  it('accepts the other shapes the theme emits', () => {
    expect(parseChapterNumber('Chapter 007').number).toBe('7')
    expect(parseChapterNumber('  chapter   45  ').number).toBe('45')
    expect(parseChapterNumber('Ch 8.10').number).toBe('8.1')
    expect(parseChapterNumber('Episode 33 — Homecoming')).toEqual({
      number: '33',
      title: 'Homecoming',
      volume: null,
    })
    expect(parseChapterNumber('#12').number).toBe('12')
    expect(parseChapterNumber('Volume 3 Chapter 9')).toEqual({
      number: '9',
      title: null,
      volume: 3,
    })
    expect(parseChapterNumber('Chapter 45 (Part 2)')).toEqual({
      number: '45',
      title: '(Part 2)',
      volume: null,
    })
    expect(parseChapterNumber('Chapter 3 &#8211; Rain')).toEqual({
      number: '3',
      title: 'Rain',
      volume: null,
    })
  })

  it('never guesses: unparseable names come back null', () => {
    for (const name of [
      'Prologue',
      'Season 2 Finale',
      'Chapter 1-2',
      'Chapter 1 2',
      'Chapter 5v2',
      'Extra: Side Story',
      '',
      '   ',
      'Chapter 1.2345',
      'Chapter 123456789',
    ]) {
      expect(parseChapterNumber(name).number, name).toBeNull()
      expect(isUnparsedChapterName(name), name).toBe(true)
    }
  })

  it('keeps a title remainder for the reviewer even when the number fails', () => {
    expect(parseChapterNumber('Prologue').title).toBe('Prologue')
    expect(parseChapterNumber('Chapter 1-2').title).toBe('Chapter 1-2')
  })

  it('produces numeric(10,3)-safe strings', () => {
    for (const name of ['Chapter 12.500', 'Chapter 0012.5', 'Ch.12.5']) {
      expect(parseChapterNumber(name).number).toBe('12.5')
    }
    expect(Number.parseFloat(parseChapterNumber('Chapter 9999999').number ?? '')).toBe(9999999)
  })
})
