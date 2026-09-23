import { describe, expect, it } from 'vitest'
import {
  type AniListMedia,
  mapCredits,
  mapMedia,
  mapSearchResults,
  mapStatus,
  mapTitles,
  mapType,
  plainDescription,
} from '../metadata/anilist.js'

/**
 * The AniList mapper. Everything here is about the decisions in the mapping — the fetch is
 * elsewhere and needs no test of its own.
 *
 * The fixture is invented rather than a copy of a real listing: the point is the shape of
 * AniList's response, and inventing it keeps someone else's synopsis out of this repository.
 */
const fixture = (over: Partial<AniListMedia> = {}): AniListMedia => ({
  id: 4242,
  siteUrl: 'https://anilist.co/manga/4242',
  title: { romaji: 'Hoshi no Kakera', english: 'Shard of Stars', native: '星のかけら' },
  synonyms: ['Star Shard'],
  description: 'A courier crosses a dead city.<br><i>Volume one</i> collects the first arc.',
  format: 'MANGA',
  status: 'RELEASING',
  countryOfOrigin: 'JP',
  startDate: { year: 2019 },
  genres: ['Action', 'Drama'],
  isAdult: false,
  coverImage: {
    extraLarge: 'https://img.example/xl.jpg',
    large: 'https://img.example/l.jpg',
    color: '#3a6ea5',
  },
  staff: {
    edges: [
      { role: 'Story & Art', node: { name: { full: 'A. Mapper' } } },
      { role: 'Assistant', node: { name: { full: 'Nobody Relevant' } } },
    ],
  },
  ...over,
})

describe('what kind of comic it is', () => {
  it('reads the country, not the format — every one of them is format MANGA', () => {
    expect(mapType('MANGA', 'JP')).toBe('manga')
    expect(mapType('MANGA', 'KR')).toBe('manhwa')
    expect(mapType('MANGA', 'CN')).toBe('manhua')
    expect(mapType('MANGA', 'TW')).toBe('manhua')
  })

  it('still lets the format win when it is a novel', () => {
    expect(mapType('NOVEL', 'JP')).toBe('novel')
  })

  it('falls back to manga when the country is missing rather than refusing', () => {
    expect(mapType(null, null)).toBe('manga')
  })
})

describe('publication status', () => {
  it('maps the ones that have a counterpart here', () => {
    expect(mapStatus('FINISHED')).toBe('completed')
    expect(mapStatus('RELEASING')).toBe('ongoing')
    expect(mapStatus('HIATUS')).toBe('hiatus')
    expect(mapStatus('CANCELLED')).toBe('cancelled')
  })

  it('treats an unannounced or unknown status as ongoing', () => {
    expect(mapStatus('NOT_YET_RELEASED')).toBe('ongoing')
    expect(mapStatus(null)).toBe('ongoing')
  })
})

describe('credits', () => {
  it('splits "Story & Art" into both credits for the same person', () => {
    expect(mapCredits(fixture())).toEqual([
      { name: 'A. Mapper', credit: 'author' },
      { name: 'A. Mapper', credit: 'artist' },
    ])
  })

  it('drops a role that is neither, rather than guessing', () => {
    // An assistant or a letterer credited as the author is worse than no credit at all.
    expect(mapCredits(fixture()).map((p) => p.name)).not.toContain('Nobody Relevant')
  })

  it('separates story from art when two people share a title', () => {
    const media = fixture({
      staff: {
        edges: [
          { role: 'Story', node: { name: { full: 'Writer One' } } },
          { role: 'Art', node: { name: { full: 'Artist Two' } } },
        ],
      },
    })
    expect(mapCredits(media)).toEqual([
      { name: 'Writer One', credit: 'author' },
      { name: 'Artist Two', credit: 'artist' },
    ])
  })

  it('does not credit the same person twice for a repeated role', () => {
    const media = fixture({
      staff: {
        edges: [
          { role: 'Story', node: { name: { full: 'Writer One' } } },
          { role: 'Original Story', node: { name: { full: 'Writer One' } } },
        ],
      },
    })
    expect(mapCredits(media)).toHaveLength(1)
  })
})

describe('titles', () => {
  it('shows the English title and keeps the rest as alternatives', () => {
    const { title, altTitles } = mapTitles(fixture())
    expect(title).toBe('Shard of Stars')
    expect(altTitles).toEqual(['Hoshi no Kakera', '星のかけら', 'Star Shard'])
  })

  it('falls back to romaji when there is no English title', () => {
    const { title } = mapTitles(
      fixture({ title: { romaji: 'Hoshi no Kakera', english: null, native: '星のかけら' } }),
    )
    expect(title).toBe('Hoshi no Kakera')
  })

  it('never repeats the display title in the alternatives', () => {
    const { title, altTitles } = mapTitles(
      fixture({ synonyms: ['Shard of Stars', 'shard of stars'] }),
    )
    expect(altTitles.map((t) => t.toLowerCase())).not.toContain(title.toLowerCase())
  })
})

describe('the synopsis', () => {
  it('comes out as plain text — AniList sends HTML whatever asHtml says', () => {
    expect(plainDescription('One line.<br><br>Another <i>emphasised</i> line.')).toBe(
      'One line.\n\nAnother emphasised line.',
    )
  })

  it('decodes the entities editors type by hand', () => {
    expect(plainDescription('Bread &amp; butter &quot;quoted&quot;')).toBe(
      'Bread & butter "quoted"',
    )
  })

  it('is null rather than an empty string when there is nothing to say', () => {
    expect(plainDescription(null)).toBeNull()
    expect(plainDescription('   ')).toBeNull()
  })
})

describe('a whole candidate', () => {
  it('carries everything the series editor fills in', () => {
    expect(mapMedia(fixture())).toEqual({
      sourceId: 'anilist:4242',
      sourceUrl: 'https://anilist.co/manga/4242',
      title: 'Shard of Stars',
      altTitles: ['Hoshi no Kakera', '星のかけら', 'Star Shard'],
      synopsis: 'A courier crosses a dead city.\nVolume one collects the first arc.',
      type: 'manga',
      status: 'ongoing',
      country: 'JP',
      releasedYear: 2019,
      genres: ['Action', 'Drama'],
      people: [
        { name: 'A. Mapper', credit: 'author' },
        { name: 'A. Mapper', credit: 'artist' },
      ],
      coverUrl: 'https://img.example/xl.jpg',
      coverColor: '#3a6ea5',
      ageRating: null,
    })
  })

  it('leaves the age rating alone unless AniList says adult', () => {
    // `isAdult` is a boolean, so "mature" is the only thing it can assert. Anything else must
    // stay null so applying a candidate does not overwrite the operator's own choice.
    expect(mapMedia(fixture()).ageRating).toBeNull()
    expect(mapMedia(fixture({ isAdult: true })).ageRating).toBe('mature')
  })

  it('survives a response with almost nothing in it', () => {
    const bare = mapMedia({ id: 7 })
    expect(bare.title).toBe('AniList #7')
    expect(bare.sourceUrl).toBe('https://anilist.co/manga/7')
    expect(bare.synopsis).toBeNull()
    expect(bare.coverUrl).toBeNull()
    expect(bare.genres).toEqual([])
    expect(bare.people).toEqual([])
  })
})

describe('a page of search results', () => {
  it('drops the nulls AniList pads a page with', () => {
    expect(mapSearchResults([fixture(), null, undefined, { id: 9 }])).toHaveLength(2)
  })
})
