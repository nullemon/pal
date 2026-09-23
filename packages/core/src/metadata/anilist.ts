import type { SeriesStatus, SeriesType } from '../import/map.js'

/**
 * AniList as a metadata source for the catalogue (Admin → Series → Look up).
 *
 * Everything in this file is pure: the query documents and the mapping from AniList's shape
 * to ours. The fetch lives in `apps/web/lib/metadata/anilist.ts`, so the part with all the
 * decisions in it — which title wins, what a "Story & Art" credit means, how `countryOfOrigin`
 * picks between manga and manhwa — is unit-testable against a fixture and never needs the
 * network.
 *
 * Why AniList rather than scraping a reading site: it is a public GraphQL API with no key and
 * no signup, and it carries exactly the fields this site models — cover art, the three title
 * forms, staff with roles, genres, status, start year. A scraper for an arbitrary site would
 * need a parser per site and would break on their next redesign.
 *
 * What this does **not** do is decide anything for the operator. It returns a candidate; the
 * panel shows it, the operator picks, reviews the filled fields and saves. Nothing about an
 * imported series is published automatically.
 */

export const ANILIST_ENDPOINT = 'https://graphql.anilist.co'

/** `MANGA` covers manhwa and manhua too; AniList separates them by `countryOfOrigin`. */
const MEDIA_FIELDS = `
  id
  siteUrl
  title { romaji english native }
  synonyms
  description(asHtml: false)
  format
  status
  countryOfOrigin
  startDate { year }
  genres
  isAdult
  coverImage { extraLarge large color }
  staff(sort: RELEVANCE, perPage: 12) {
    edges { role node { name { full } } }
  }
`

/** Search by title. `perPage` is small on purpose: this is a pick-one-from-a-list, not a browse. */
export const SEARCH_QUERY = `
query Search($search: String!, $perPage: Int!) {
  Page(page: 1, perPage: $perPage) {
    media(search: $search, type: MANGA, sort: SEARCH_MATCH) { ${MEDIA_FIELDS} }
  }
}`

/** One title by id, for "apply this candidate" — the search result may be stale by then. */
export const BY_ID_QUERY = `
query ById($id: Int!) {
  Media(id: $id, type: MANGA) { ${MEDIA_FIELDS} }
}`

export interface AniListMedia {
  id: number
  siteUrl?: string | null
  title?: { romaji?: string | null; english?: string | null; native?: string | null } | null
  synonyms?: readonly string[] | null
  description?: string | null
  format?: string | null
  status?: string | null
  countryOfOrigin?: string | null
  startDate?: { year?: number | null } | null
  genres?: readonly string[] | null
  isAdult?: boolean | null
  coverImage?: { extraLarge?: string | null; large?: string | null; color?: string | null } | null
  staff?: {
    edges?:
      | readonly {
          role?: string | null
          node?: { name?: { full?: string | null } | null } | null
        }[]
      | null
  } | null
}

export type MetadataCredit = 'author' | 'artist'

export interface MetadataPerson {
  name: string
  credit: MetadataCredit
}

/**
 * One candidate, in this site's vocabulary. Deliberately flat and free of nulls-as-empty
 * strings: a field the source does not know is `null`, so the apply step can tell "AniList
 * has no year" from "the year is blank" and leave what the operator already typed alone.
 */
export interface SeriesMetadata {
  /** `anilist:123` — stored on the series so a re-sync knows what it matched. */
  sourceId: string
  sourceUrl: string | null
  title: string
  altTitles: string[]
  synopsis: string | null
  type: SeriesType
  status: SeriesStatus
  /** ISO-3166 alpha-2, as `series.country` stores it. */
  country: string | null
  releasedYear: number | null
  genres: string[]
  people: MetadataPerson[]
  /** Fetched server-side and pushed through the normal `series.art` pipeline, never hotlinked. */
  coverUrl: string | null
  coverColor: string | null
  ageRating: 'all' | 'teen' | 'mature' | null
}

const clean = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim()
  return s === '' ? null : s
}

/**
 * AniList's `description` is HTML even with `asHtml: false` — the field only stops it adding
 * its own wrapper, and editors write `<br>` and `<i>` by hand. `synopsis` is plain text on
 * this site, so the tags come out and the breaks become blank lines.
 */
export const plainDescription = (raw: string | null | undefined): string | null => {
  if (!raw) return null
  const text = raw
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*p\s*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text === '' ? null : text
}

/**
 * Manga, manhwa or manhua is a question about where it was published, and AniList answers it
 * with `countryOfOrigin` rather than `format` — every one of them is `format: MANGA`. Getting
 * this from the format alone would file every Korean title as manga, which is the single most
 * visible thing a reader would notice being wrong.
 */
export const mapType = (
  format: string | null | undefined,
  country: string | null | undefined,
): SeriesType => {
  if ((format ?? '').toUpperCase() === 'NOVEL') return 'novel'
  switch ((country ?? '').toUpperCase()) {
    case 'KR':
      return 'manhwa'
    case 'CN':
    case 'TW':
    case 'HK':
      return 'manhua'
    default:
      return 'manga'
  }
}

/**
 * `NOT_YET_RELEASED` has no counterpart here and is deliberately mapped to `ongoing` rather
 * than left out: an announced title the operator is adding early is one they intend to carry,
 * and `ongoing` is what they would have picked. It is visible in the panel either way.
 */
export const mapStatus = (status: string | null | undefined): SeriesStatus => {
  switch ((status ?? '').toUpperCase()) {
    case 'FINISHED':
      return 'completed'
    case 'HIATUS':
      return 'hiatus'
    case 'CANCELLED':
      return 'cancelled'
    default:
      return 'ongoing'
  }
}

/**
 * AniList staff roles are free text: "Story & Art", "Story", "Art", "Original Story",
 * "Illustration", and translations of all of them. Matching on the two words that carry the
 * meaning covers the overwhelming majority and, crucially, a role that matches neither is
 * dropped rather than guessed at — an editor or a letterer credited as the author is worse
 * than no credit at all.
 */
export const mapCredits = (media: AniListMedia): MetadataPerson[] => {
  const out: MetadataPerson[] = []
  const seen = new Set<string>()
  const add = (name: string, credit: MetadataCredit) => {
    const key = `${credit}:${name.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ name, credit })
  }
  for (const edge of media.staff?.edges ?? []) {
    const name = clean(edge?.node?.name?.full)
    if (!name) continue
    const role = (edge?.role ?? '').toLowerCase()
    const story = /stor(y|ies)|writer|author|original/.test(role)
    const art = /\bart\b|artist|illustrat|drawing/.test(role)
    if (story) add(name, 'author')
    if (art) add(name, 'artist')
  }
  return out
}

/**
 * The display title, and everything else as an alternative.
 *
 * English first because this is an English-language site and it is the name a reader will
 * search for; romaji is the fallback because a great many titles have no official English
 * one. The native title and AniList's `synonyms` become alt titles, which is what the search
 * index and the "also known as" line use — so a reader who knows it by its Japanese name
 * still finds it.
 */
export const mapTitles = (media: AniListMedia): { title: string; altTitles: string[] } => {
  const english = clean(media.title?.english)
  const romaji = clean(media.title?.romaji)
  const native = clean(media.title?.native)
  const title = english ?? romaji ?? native ?? `AniList #${media.id}`
  const alts: string[] = []
  const seen = new Set([title.toLowerCase()])
  for (const candidate of [english, romaji, native, ...(media.synonyms ?? [])]) {
    const value = clean(candidate)
    if (!value || seen.has(value.toLowerCase())) continue
    seen.add(value.toLowerCase())
    alts.push(value)
  }
  return { title, altTitles: alts.slice(0, 12) }
}

/**
 * `isAdult` is the only signal AniList gives, and it is a boolean — so this can say "mature"
 * and nothing else. A title that is merely violent comes back `null`, which leaves the
 * operator's own choice in place rather than overwriting it with a guess.
 */
const mapAgeRating = (media: AniListMedia): SeriesMetadata['ageRating'] =>
  media.isAdult === true ? 'mature' : null

/** One AniList `Media` as a candidate this site can show and apply. */
export const mapMedia = (media: AniListMedia): SeriesMetadata => {
  const { title, altTitles } = mapTitles(media)
  const country = clean(media.countryOfOrigin)
  return {
    sourceId: `anilist:${media.id}`,
    sourceUrl: clean(media.siteUrl) ?? `https://anilist.co/manga/${media.id}`,
    title,
    altTitles,
    synopsis: plainDescription(media.description),
    type: mapType(media.format, country),
    status: mapStatus(media.status),
    country: country ? country.toUpperCase().slice(0, 2) : null,
    releasedYear: media.startDate?.year ?? null,
    genres: [...(media.genres ?? [])].map((g) => g.trim()).filter(Boolean),
    people: mapCredits(media),
    coverUrl: clean(media.coverImage?.extraLarge) ?? clean(media.coverImage?.large),
    coverColor: clean(media.coverImage?.color),
    ageRating: mapAgeRating(media),
  }
}

/** The search response, mapped and with anything unusable dropped. */
export const mapSearchResults = (
  media: readonly (AniListMedia | null | undefined)[],
): SeriesMetadata[] =>
  media.filter((m): m is AniListMedia => !!m && typeof m.id === 'number').map(mapMedia)
