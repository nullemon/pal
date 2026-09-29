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
