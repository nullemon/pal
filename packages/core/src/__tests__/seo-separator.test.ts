import { describe, expect, it } from 'vitest'
import {
  chapterCountLabel,
  DEFAULT_SEO_TEMPLATES,
  DEFAULT_SEPARATOR,
  renderSeo,
  type SeoPageType,
} from '../templates.js'

/**
 * Separators, and the failure that put "One Punch Man Read Online Free PALScans" into Google.
 *
 * `sep` is a setting rather than a fact about the page, so it has to be threaded from the SEO
 * settings into every `renderSeo` call — and not one call site did. A missing variable renders
 * as the empty string and `renderTemplate` then collapses the doubled spaces around it, so
 * `{title} {sep} Read Online Free {sep} {site}` silently became three words in a row.
 *
 * Nothing caught it: the types are satisfied (the variables bag is `Record<string, …>`, so an
 * absent key is not an error), the templates were right, and the renderer was right. Only the
 * rendered output was wrong, and only on pages that used templates — which is why Browse,
 * which does not, was the one result in the search listing that still had its dash.
 *
 * So the check belongs on the output, and it has to be one that fails when a caller forgets.
 */

const PAGES = Object.keys(DEFAULT_SEO_TEMPLATES) as SeoPageType[]

const vars = {
  site: 'PALScans',
  title: 'One Punch Man',
  type: 'Manga',
  chapter: '240',
  chapter_count: 12,
  chapter_label: chapterCountLabel(12),
  latest_chapter: 'Ch. 240',
  genre: 'Action',
  count: 40,
  intro: 'Intro text.',
  excerpt: 'Excerpt text.',
  synopsis: 'A hero for fun.',
  next_prev_hint: '',
}

describe('every default template keeps its separator', () => {
  it.each(PAGES)('%s renders a separator when the caller omits sep', (page) => {
    const template = DEFAULT_SEO_TEMPLATES[page].title
    if (!template.includes('{sep}')) return
    // The exact reproduction of the bug: a caller that never supplies `sep`.
    expect(renderSeo(page, vars).title).toContain(DEFAULT_SEPARATOR)
  })

  it.each(PAGES)('%s honours an operator separator over the default', (page) => {
    const template = DEFAULT_SEO_TEMPLATES[page].title
    if (!template.includes('{sep}')) return
    const title = renderSeo(page, { ...vars, sep: '·' }).title
    expect(title).toContain('·')
    expect(title).not.toContain(DEFAULT_SEPARATOR)
  })

  it('never runs words together where a separator belongs', () => {
    // What a reader of the search result actually sees. Without the fix this is
    // "One Punch Man Read Online Free PALScans".
    expect(renderSeo('series', vars).title).toBe('One Punch Man - Read Online Free - PALScans')
  })
})

describe('chapter counts agree with their noun', () => {
  it('says "1 chapter", not "1 chapters"', () => {
    const one = { ...vars, chapter_count: 1, chapter_label: chapterCountLabel(1) }
    expect(renderSeo('series', one).description).toContain('1 chapter,')
    expect(renderSeo('series', one).description).not.toContain('1 chapters')
  })

  it('still pluralises everything else, including zero', () => {
    expect(chapterCountLabel(0)).toBe('chapters')
    expect(chapterCountLabel(2)).toBe('chapters')
    expect(chapterCountLabel(240)).toBe('chapters')
  })
})

/**
 * The second failure, which the first fix could not have caught.
 *
 * Threading `sep` through fixed the titles that had *no* separator. These are the titles that
 * have too many, which arrived in the search results looking like this:
 *
 *   PALScans · - Read Manhwa, Manga and Manhua Online
 *   Blue Lock - - Read Online Free - PALScans
 *
 * The first is `{site}` rendering empty against a saved site name of a single space: the dash
 * is left leading the title and Google prepends the site name it worked out itself. The second
 * is a template carrying both `{sep}` and a literal dash, which an operator editing the
 * templates by hand can type without any feedback that it is wrong.
 *
 * Collapsing whitespace — all the renderer did — cannot repair either: a dash is a character,
 * so closing the gap around it leaves the dash. The repair has to be on the separator itself.
 */
describe('separators that render against nothing', () => {
  it('drops a separator the empty site name left leading the title', () => {
    const home = renderSeo('home', { ...vars, site: ' ' })
    expect(home.title).toBe('Read Manhwa, Manga and Manhua Online')
  })

  it('collapses a doubled separator in a hand-edited template', () => {
    const title = renderSeo(
      'series',
      { ...vars },
      { series: { title: '{title} {sep} - Read Online Free {sep} {site}' } },
    ).title
    expect(title).toBe('One Punch Man - Read Online Free - PALScans')
  })

  it('drops a trailing separator when the last variable is empty', () => {
    expect(renderSeo('series', { ...vars, site: null }).title).toBe(
      'One Punch Man - Read Online Free',
    )
  })

  it('repairs a run of three, and under an operator separator', () => {
    const title = renderSeo(
      'series',
      { ...vars, sep: '·' },
      { series: { title: '{title} {sep} · · Read Online Free {sep} {site}' } },
    ).title
    expect(title).toBe('One Punch Man · Read Online Free · PALScans')
  })

  it('leaves punctuation inside words alone', () => {
    // The separator is punctuation *between* things. A hyphen inside a word is part of it,
    // and a description that reads "fast, mobile-friendly" must survive the repair intact.
    expect(renderSeo('home', vars).description).toContain('mobile-friendly')
    expect(
      renderSeo('series', { ...vars, title: 'Re-Monster' }, { series: { title: '{title}' } }).title,
    ).toBe('Re-Monster')
  })

  it('does not touch a separator the page is not using', () => {
    // An operator on `·` has not asked for their dashes to be tidied up.
    expect(
      renderSeo('series', { ...vars, sep: '·' }, { series: { title: '{title} - - {sep} {site}' } })
        .title,
    ).toBe('One Punch Man - - · PALScans')
  })
})
