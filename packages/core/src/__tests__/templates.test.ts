import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SEO_TEMPLATES,
  renderSeo,
  renderTemplate,
  templateVariables,
  truncateWords,
} from '../templates.js'

const synopsis =
  'Executed by the empire he built, Kael Vantheris wakes three hundred years in the past with his memories intact and his power gone. The Frost Monarch has one winter to rebuild an army, and this time he remembers every betrayal.'

describe('truncateWords', () => {
  it('cuts at a word boundary with an ellipsis', () => {
    const t = truncateWords(synopsis, 160)
    expect(t.length).toBeLessThanOrEqual(160)
    expect(t.endsWith('…')).toBe(true)
    expect(t).not.toMatch(/\s…$/)
    // never splits a word: the text before the ellipsis is a prefix ending at a space
    expect(synopsis.startsWith(t.slice(0, -1))).toBe(true)
    expect(synopsis.charAt(t.length - 1)).toBe(' ')
  })
  it('returns short text unchanged', () => {
    expect(truncateWords('short text', 160)).toBe('short text')
    expect(truncateWords('  spaced   out  ', 160)).toBe('spaced out')
  })
  it('hard-cuts a single overlong word', () => {
    expect(truncateWords('x'.repeat(50), 10)).toBe(`${'x'.repeat(9)}…`)
  })
})

describe('renderTemplate', () => {
  it('substitutes docs/12 §2 variables', () => {
    const out = renderSeo('series', {
      site: 'PALScans',
      sep: '-',
      title: 'Return of the Frost Monarch',
      type: 'manhwa',
      chapter_count: 301,
      latest_chapter: 'Ch. 301',
      synopsis,
    })
    expect(out.title).toBe('Return of the Frost Monarch - Read Online Free - PALScans')
    expect(
      out.description.startsWith(
        'Read Return of the Frost Monarch manhwa online. 301 chapters, latest Ch. 301. Executed by',
      ),
    ).toBe(true)
    expect(out.description.endsWith('…')).toBe(true)
  })
  it('titles a chapter page with the words people search for', () => {
    const vars = { site: 'PALScans', sep: '-', title: 'Naruto', chapter: 208 }
    expect(renderSeo('chapter', vars).title).toBe('Read Naruto Chapter 208 Online Free - PALScans')
    // the separator is a setting, so switching it re-titles every page
    expect(renderSeo('chapter', { ...vars, sep: '·' }).title).toBe(
      'Read Naruto Chapter 208 Online Free · PALScans',
    )
  })

  it('describes a chapter with its language and what the series is about', () => {
    const out = renderSeo('chapter', {
      site: 'PALScans',
      sep: '-',
      title: 'Naruto',
      chapter: 208,
      language: 'English',
      synopsis: 'A young ninja who seeks recognition from his peers dreams of leading his village.',
    })
    expect(out.description).toBe(
      'Read Naruto Chapter 208 online free in English at PALScans. A young ninja who seeks recognition from his peers dreams of leading his village.',
    )
  })

  it('still reads as a sentence for a series with no synopsis', () => {
    // An empty variable must not leave "at PALScans. " hanging or a stray separator behind.
    const out = renderSeo('chapter', {
      site: 'PALScans',
      sep: '-',
      title: 'Naruto',
      chapter: 208,
      language: 'English',
      synopsis: '',
    })
    expect(out.description).toBe('Read Naruto Chapter 208 online free in English at PALScans.')
  })

  it('drops unknown/empty variables and collapses whitespace', () => {
    expect(
      renderTemplate('Read {title} Chapter {chapter} at {site}. {next_prev_hint}', {
        title: 'Overgrowth',
        chapter: '12.5',
        site: 'PALScans',
      }),
    ).toBe('Read Overgrowth Chapter 12.5 at PALScans.')
    expect(renderTemplate('{genre} · {missing} · {site}', { genre: 'Action', site: 'P' })).toBe(
      // The doubling is debris from the empty `{missing}`; the `·` is the operator's own
      // character and survives, because the site separator (`-`) is not part of the run.
      'Action · P',
    )
  })
  it('respects overrides and lists variables', () => {
    const out = renderSeo('home', { site: 'PALScans' }, { home: { title: 'Custom {site}' } })
    expect(out.title).toBe('Custom PALScans')
    expect(out.description).toBe(
      DEFAULT_SEO_TEMPLATES.home.description.replace('{site}', 'PALScans'),
    )
    expect(templateVariables(DEFAULT_SEO_TEMPLATES.series.description)).toEqual([
      'title',
      'type',
      'chapter_count',
      // Agrees with the count, so a one-chapter series does not read "1 chapters".
      // Derived by `renderSeo` when a caller omits it — see seo-separator.test.ts.
      'chapter_label',
      'latest_chapter',
      'synopsis',
    ])
  })
})
