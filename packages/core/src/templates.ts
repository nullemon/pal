/**
 * SEO title/description templates (docs/12-seo.md §2).
 * Variables: {site} {sep} {title} {type} {chapter} {chapter_count} {latest_chapter} {genres}
 * {author} {year} {synopsis:N} {genre} {count} {intro:N} {excerpt:N} {next_prev_hint}.
 * Any variable may take `:N` to truncate at a word boundary.
 */
export type TemplateVars = Record<string, string | number | null | undefined>

export type SeoPageType = 'home' | 'series' | 'chapter' | 'genre' | 'rankings' | 'announcement'

export interface SeoTemplate {
  title: string
  description: string
}

/**
 * The separator used when a caller does not supply one.
 *
 * `sep` is a *setting*, not a fact about the page, so every call site has to remember to
 * thread it through from the SEO settings — and a forgotten one renders as the empty string,
 * which `renderTemplate` then collapses along with its surrounding spaces. The failure is
 * silent and looks like nothing at all: `{title} {sep} Read Online Free {sep} {site}` becomes
 * "One Punch Man Read Online Free PALScans". `renderSeo` therefore fills it in rather than
 * trusting callers, and an explicit separator still wins.
 */
export const DEFAULT_SEPARATOR = '-'

export const DEFAULT_SEO_TEMPLATES: Record<SeoPageType, SeoTemplate> = {
  home: {
    title: '{site} {sep} Read Manhwa, Manga and Manhua Online',
    description:
      'Read the latest manhwa, manga and manhua chapters on {site}, updated daily. Free, fast, mobile-friendly.',
  },
  series: {
    title: '{title} {sep} Read Online Free {sep} {site}',
    description:
      'Read {title} {type} online. {chapter_count} {chapter_label}, latest {latest_chapter}. {synopsis:160}',
  },
  chapter: {
    title: '{title} Chapter {chapter} {sep} {site}',
    description: 'Read {title} Chapter {chapter} online free at {site}. {next_prev_hint}',
  },
  genre: {
    title: '{genre} Manhwa & Manga {sep} Read Online {sep} {site}',
    description: 'Browse {count} {genre} series on {site}. {intro:160}',
  },
  rankings: {
    title: 'Top Manhwa & Manga This Week {sep} {site}',
    description: 'The most-read manhwa, manga and manhua on {site} this week, month and all time.',
  },
  announcement: {
    title: '{title} {sep} {site}',
    description: '{excerpt:160}',
  },
}

export const TEMPLATE_VARIABLES = [
  'site',
  'sep',
  'title',
  'type',
  'chapter',
  'chapter_count',
  /** 'chapter' or 'chapters', agreeing with `chapter_count` — see `chapterLabel`. */
  'chapter_label',
  'latest_chapter',
  'genres',
  'author',
  'year',
  'synopsis',
  'genre',
  'count',
  'intro',
  'excerpt',
  'next_prev_hint',
] as const

const TOKEN = /\{([a-z_]+)(?::(\d+))?\}/g

/**
 * Truncate at a word boundary to at most `max` characters, appending an ellipsis when cut.
 * Never splits a word; if the first word alone exceeds `max` it is hard-cut.
 */
export const truncateWords = (text: string, max: number, ellipsis = '…'): string => {
  const s = text.replace(/\s+/g, ' ').trim()
  if (s.length <= max) return s
  const room = Math.max(0, max - ellipsis.length)
  const cut = s.slice(0, room + 1)
  const boundary = cut.lastIndexOf(' ')
  const head = (boundary > 0 ? cut.slice(0, boundary) : s.slice(0, room)).replace(
    /[\s,;:.\-–—]+$/,
    '',
  )
  return `${head}${ellipsis}`
}

/** Render a template. Unknown or empty variables render as '' and leftover whitespace collapses. */
export const renderTemplate = (template: string, vars: TemplateVars): string =>
  template
    .replace(TOKEN, (_m, name: string, len?: string) => {
      const raw = vars[name]
      if (raw === null || raw === undefined) return ''
      const value = String(raw)
      return len ? truncateWords(value, Number.parseInt(len, 10)) : value
    })
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim()

/**
 * The noun that agrees with a chapter count: one chapter, two chapters.
 *
 * Supplied as `{chapter_label}` so a template reads `{chapter_count} {chapter_label}` and a
 * series with a single chapter no longer advertises "1 chapters" in every search result.
 */
export const chapterCountLabel = (count: number): string => (count === 1 ? 'chapter' : 'chapters')

/**
 * Fill the variables that can be derived, so no call site has to remember them.
 *
 * A missing variable renders as the empty string and `renderTemplate` then collapses the
 * spaces around it, which is how `{title} {sep} Read Online Free {sep} {site}` reached Google
 * as "One Punch Man Read Online Free PALScans" — silently, with the types satisfied and the
 * template correct. `chapter_label` fails the same way, turning "301 chapters, latest" into
 * "301, latest". Anything explicitly supplied still wins.
 *
 * Both `renderSeo` and the Next metadata builder pass through here. They rendered templates by
 * two different routes, and the one that did not default was the one serving every series page.
 */
export const seoVars = (vars: TemplateVars): TemplateVars => {
  const count = Number(vars.chapter_count)
  return {
    ...vars,
    sep: vars.sep ?? DEFAULT_SEPARATOR,
    chapter_label:
      vars.chapter_label ?? (Number.isFinite(count) ? chapterCountLabel(count) : undefined),
  }
}

export const renderSeo = (
  page: SeoPageType,
  vars: TemplateVars,
  overrides?: Partial<Record<SeoPageType, Partial<SeoTemplate>>>,
): SeoTemplate => {
  const base = DEFAULT_SEO_TEMPLATES[page]
  const t = { ...base, ...(overrides?.[page] ?? {}) }
  const v = seoVars(vars)
  return {
    title: renderTemplate(t.title, v),
    description: renderTemplate(t.description, v),
  }
}

/** Variables a template references, e.g. for the admin live preview checklist. */
export const templateVariables = (template: string): string[] => {
  const out = new Set<string>()
  for (const m of template.matchAll(TOKEN)) if (m[1]) out.add(m[1])
  return [...out]
}
