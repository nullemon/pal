import { describe, expect, it } from 'vitest'
import { CHAPTER_LANGUAGES } from '../languages.js'
import {
  CHAPTER_LOCALES,
  chapterLocale,
  DEFAULT_CHAPTER_LOCALE,
  languagesWithoutLocale,
  localeChapterHint,
  localeChapterLabel,
} from '../locale.js'
import { chapterLabel } from '../time.js'

/**
 * What a chapter page says in the language the chapter is in.
 *
 * The case that matters is the silent one: a language added to the uploader's picker with
 * no strings here would serve German readers an English title, and nothing would fail —
 * the page would render, return 200, and quietly compete for the wrong queries.
 */

describe('the locale table', () => {
  it('has strings for every language an uploader can pick', () => {
    expect(languagesWithoutLocale()).toEqual([])
  })

  it('offers no language the picker does not', () => {
    const picker = new Set(CHAPTER_LANGUAGES.map((l) => l.code))
    expect(CHAPTER_LOCALES.filter((l) => !picker.has(l.code)).map((l) => l.code)).toEqual([])
  })

  it('writes the number into every label, wherever that language puts it', () => {
    for (const locale of CHAPTER_LOCALES) {
      expect(locale.label, locale.code).toContain('{n}')
      // Japanese wraps the number and Korean suffixes it, so a label is a pattern rather
      // than a word — this is what stops someone "simplifying" it back to a noun.
      expect(localeChapterLabel(locale.code, '1196'), locale.code).toContain('1196')
    }
  })

  it('keeps the tokens a rendered title needs', () => {
    for (const locale of CHAPTER_LOCALES) {
      for (const token of ['{title}', '{chapter}', '{site}']) {
        expect(locale.seo.title + locale.seo.description, `${locale.code} ${token}`).toContain(
          token,
        )
      }
      expect(locale.seo.description, locale.code).toContain('{next_prev_hint}')
      expect(locale.previous, locale.code).toContain('{n}')
      expect(locale.next, locale.code).toContain('{n}')
    }
  })

  it('falls back to English for a language it does not know', () => {
    expect(chapterLocale('kl')).toBe(DEFAULT_CHAPTER_LOCALE)
    expect(chapterLocale(null)).toBe(DEFAULT_CHAPTER_LOCALE)
    expect(chapterLocale(undefined).code).toBe('en')
  })
})

describe('localeChapterLabel', () => {
  it('writes German, Japanese and Korean the way each of them writes it', () => {
    expect(localeChapterLabel('de', '1196')).toBe('Kapitel 1196')
    expect(localeChapterLabel('ja', '1196')).toBe('第1196話')
    expect(localeChapterLabel('ko', '1196')).toBe('1196화')
  })
})

describe('localeChapterHint', () => {
  it('names both neighbours in the chapter’s language', () => {
    expect(localeChapterHint('de', '1195', '1197')).toBe(
      'Vorheriges: Kapitel 1195. Nächstes: Kapitel 1197.',
    )
  })

  it('says nothing about a neighbour that does not exist', () => {
    expect(localeChapterHint('de', null, '2')).toBe('Nächstes: Kapitel 2.')
    expect(localeChapterHint('de', null, null)).toBe('')
  })
})

describe('chapterLabel', () => {
  it('leaves English exactly as it was', () => {
    // Every label on the site goes through here, so this is the regression that matters.
    expect(chapterLabel(301)).toBe('Ch. 301')
    expect(chapterLabel(301, 'long')).toBe('Chapter 301')
    expect(chapterLabel(301, 'hash')).toBe('#301')
    expect(chapterLabel(301, 'short', 'en')).toBe('Ch. 301')
  })

  it('translates the words and leaves the number alone', () => {
    expect(chapterLabel(301, 'long', 'de')).toBe('Kapitel 301')
    // No invented abbreviation: most languages have no agreed one, and a guessed "Kap."
    // is worse than a word that is simply correct.
    expect(chapterLabel(301, 'short', 'de')).toBe('Kapitel 301')
    // A number with a sigil is a number in every language.
    expect(chapterLabel(301, 'hash', 'de')).toBe('#301')
  })

  it('keeps fractional numbers readable', () => {
    expect(chapterLabel(12.5, 'long', 'de')).toBe('Kapitel 12.5')
  })
})
