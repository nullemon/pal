import { DEFAULT_COPY } from '@palscans/core/copy'
import { DEFAULT_FORMATTING } from '@palscans/core/formatting'
import { messages } from '@palscans/core/messages'
import { describe, expect, it, vi } from 'vitest'

/**
 * The wiring half of the promise `@palscans/core/copy` makes: whatever is in the two
 * `settings` rows, the site still renders.
 *
 * The unit tests in `packages/core` prove the resolver is total. What is proven here is that
 * the *reader* of those rows is too — including the case nobody remembers to handle, which
 * is the database being unreachable while a page is mid-render.
 */

const state = vi.hoisted(() => ({
  rows: {} as Record<string, unknown>,
  throwOnRead: false,
}))

vi.mock('@palscans/db', () => ({
  getDb: async () => ({}),
  getSetting: async <T>(_db: unknown, key: string, fallback: T) => {
    if (state.throwOnRead) throw new Error('connection terminated unexpectedly')
    return (key in state.rows ? state.rows[key] : fallback) as T
  },
  settings: {},
}))

const { loadSiteCopy, siteCopySettings, siteCopy, siteFormatting, DEFAULT_SITE_COPY } =
  await import('./settings')

const withRows = async (rows: Record<string, unknown>) => {
  state.rows = rows
  state.throwOnRead = false
  return loadSiteCopy()
}

describe('nothing configured', () => {
  it('is byte-for-byte the shipped catalogue', async () => {
    const loaded = await withRows({})
    expect(loaded.overrides).toEqual({})
    expect(loaded.copy).toEqual(DEFAULT_COPY)
    expect(loaded.formatting).toEqual(DEFAULT_FORMATTING)
    // Which is what the pages actually render:
    expect(loaded.copy['browse.empty']).toBe(messages.browse.empty)
    expect(loaded.copy['notFoundPage.hint']).toBe(messages.notFoundPage.hint)
  })

  it('sends an empty override map to the browser', async () => {
    // The client provider serialises this on every public page; `{}` is the whole cost.
    const loaded = await withRows({ copy: { 'browse.empty': messages.browse.empty } })
    expect(loaded.overrides).toEqual({})
  })
})

describe('a configured row', () => {
  it('applies the strings that differ and leaves the rest alone', async () => {
    const loaded = await withRows({
      copy: { 'browse.empty': 'Nothing here. Try fewer filters.' },
      formatting: { chapterLabel: 'hash', numbers: 'grouped' },
    })
    expect(loaded.copy['browse.empty']).toBe('Nothing here. Try fewer filters.')
    expect(loaded.copy['search.empty']).toBe(messages.search.empty)
    expect(loaded.formatting).toEqual({
      ...DEFAULT_FORMATTING,
      chapterLabel: 'hash',
      numbers: 'grouped',
    })
  })
})

describe('a row that would break a page', () => {
  it('falls back per field rather than throwing or rendering rubbish', async () => {
    const loaded = await withRows({
      copy: {
        'browse.empty': '',
        'search.empty': 'Nothing for {sql}.',
        'comments.empty': 'x'.repeat(50_000),
        'premium.pitch': 42,
        'nav.signOut': 'not an editable string',
      },
      formatting: { relativeTimes: 'sideways', clock: null, weekStartsOn: 'caturday' },
    })
    expect(loaded.copy['browse.empty']).toBe(messages.browse.empty)
    expect(loaded.copy['search.empty']).toBe(messages.search.empty)
    expect(loaded.copy['comments.empty']).toBe(messages.comments.empty)
    expect(loaded.copy['premium.pitch']).toBe(messages.premium.pitch)
    expect(loaded.copy['nav.signOut']).toBeUndefined()
    expect(loaded.formatting).toEqual(DEFAULT_FORMATTING)
  })

  it('survives a row that is not an object at all', async () => {
    for (const junk of [null, 'string', 7, [1, 2, 3], true]) {
      const loaded = await withRows({ copy: junk, formatting: junk })
      expect(loaded.copy).toEqual(DEFAULT_COPY)
      expect(loaded.formatting).toEqual(DEFAULT_FORMATTING)
    }
  })
})

describe('when the database is unreachable', () => {
  it('renders the compiled catalogue instead of failing the page', async () => {
    state.throwOnRead = true
    await expect(siteCopySettings()).resolves.toEqual(DEFAULT_SITE_COPY)
    const copy = await siteCopy()
    expect(copy('browse.empty')).toBe(messages.browse.empty)
    expect(await siteFormatting()).toEqual(DEFAULT_FORMATTING)
    state.throwOnRead = false
  })

  it('answers "" for an id that is no longer in the registry', async () => {
    state.throwOnRead = true
    const copy = await siteCopy()
    expect(copy('a.key.that.was.removed')).toBe('')
    state.throwOnRead = false
  })
})
