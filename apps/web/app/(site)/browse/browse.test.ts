import { describe, expect, it } from 'vitest'
import {
  browseHref,
  homeHref,
  isFiltered,
  parseBrowseParams,
  searchParamsSchema,
} from '../../../components/discovery/filters'

describe('browse params', () => {
  it('parses defaults from an empty query', () => {
    const p = parseBrowseParams({})
    expect(p).toEqual({
      type: undefined,
      status: undefined,
      genre: [],
      exclude: [],
      minChapters: 0,
      minRating: 0,
      sort: 'latest',
      page: 1,
    })
    expect(isFiltered(p)).toBe(false)
  })

  it('accepts include and exclude genres, single or repeated', () => {
    const p = parseBrowseParams({ genre: 'action', exclude: ['harem', 'Harem', 'bad slug!'] })
    expect(p.genre).toEqual(['action'])
    expect(p.exclude).toEqual(['harem'])
    expect(isFiltered(p)).toBe(true)
  })

  it('falls back on junk instead of throwing', () => {
    const p = parseBrowseParams({
      type: 'anime',
      status: '',
      minChapters: 'lots',
      minRating: '99',
      sort: 'random',
      page: '-3',
    })
    expect(p.type).toBeUndefined()
    expect(p.status).toBeUndefined()
    expect(p.minChapters).toBe(0)
    expect(p.minRating).toBe(0)
    expect(p.sort).toBe('latest')
    expect(p.page).toBe(1)
  })

  it('round-trips through browseHref without defaults', () => {
    const p = parseBrowseParams({
      type: 'manhwa',
      genre: ['action', 'fantasy'],
      exclude: 'harem',
      minRating: '8',
      sort: 'rating',
      page: '2',
    })
    const href = browseHref(p)
    expect(href).toBe(
      '/browse?type=manhwa&genre=action&genre=fantasy&exclude=harem&minRating=8&sort=rating&page=2',
    )
    expect(browseHref({})).toBe('/browse')
    expect(browseHref({ page: 1, sort: 'latest' }, '/genres/action')).toBe('/genres/action')
  })

  it('builds home feed links', () => {
    expect(homeHref({})).toBe('/')
    expect(homeHref({ type: 'manga' })).toBe('/?type=manga')
    expect(homeHref({ type: 'manga', page: 3 })).toBe('/?type=manga&page=3')
  })

  it('normalises the search query', () => {
    expect(searchParamsSchema.parse({ q: '  frost   monarch ' }).q).toBe('frost monarch')
    expect(searchParamsSchema.parse({}).q).toBe('')
  })
})
