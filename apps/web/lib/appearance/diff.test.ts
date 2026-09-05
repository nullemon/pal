import { describe, expect, it } from 'vitest'
import { describeValue, diffDocuments, documentsEqual } from './diff'

/**
 * The version diff is what an operator reads before clicking Restore, so the failure that
 * matters is not "the table looks odd" — it is a change that does not appear at all.
 */

describe('diffDocuments', () => {
  it('finds nothing between identical documents', () => {
    const doc = { color: { accent: '#7c5cff' }, header: [{ label: 'Browse', href: '/browse' }] }
    expect(diffDocuments(doc, structuredClone(doc))).toEqual([])
  })

  it('names a nested field by its path', () => {
    const before = { color: { accent: '#7c5cff', secondary: '#d4a017' } }
    const after = { color: { accent: '#22c55e', secondary: '#d4a017' } }
    expect(diffDocuments(before, after)).toEqual([
      { path: 'color.accent', kind: 'changed', before: '#7c5cff', after: '#22c55e' },
    ])
  })

  it('distinguishes a key that appeared from one that changed', () => {
    const entries = diffDocuments({ a: 1 }, { b: 2 })
    expect(entries).toEqual([
      { path: 'a', kind: 'removed', before: '1', after: null },
      { path: 'b', kind: 'added', before: null, after: '2' },
    ])
  })

  it('treats a list as one field rather than renumbering every entry below an insert', () => {
    const before = { header: [{ label: 'Browse' }, { label: 'Rankings' }] }
    const after = { header: [{ label: 'New' }, { label: 'Browse' }, { label: 'Rankings' }] }
    const entries = diffDocuments(before, after)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.path).toBe('header')
    expect(entries[0]?.after).toBe('New, Browse, Rankings')
  })

  it('does not confuse an emptied string with a removed key', () => {
    expect(diffDocuments({ tagline: 'Read daily.' }, { tagline: '' })).toEqual([
      { path: 'tagline', kind: 'changed', before: 'Read daily.', after: '(empty)' },
    ])
  })

  it('sees a copy override being reset', () => {
    const entries = diffDocuments(
      { copy: { 'browse.empty': 'Nothing here.' }, formatting: { clock: '24h' } },
      { copy: {}, formatting: { clock: '12h' } },
    )
    expect(entries.map((e) => e.path)).toEqual(['copy.browse.empty', 'formatting.clock'])
  })
})

describe('describeValue', () => {
  it('renders the shapes the documents actually hold', () => {
    expect(describeValue(null)).toBe('—')
    expect(describeValue([])).toBe('(none)')
    expect(describeValue(true)).toBe('true')
    expect(describeValue([{ title: 'Browse' }, { title: 'Account' }])).toBe('Browse, Account')
    expect(describeValue([{ nothing: 1 }, { nothing: 2 }])).toBe('2 items')
  })
})

describe('documentsEqual', () => {
  it('is what the Save button asks', () => {
    expect(documentsEqual({ a: [1, 2] }, { a: [1, 2] })).toBe(true)
    expect(documentsEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false)
  })
})
