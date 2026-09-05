import { describe, expect, it } from 'vitest'
import {
  COPY_ENTRIES,
  COPY_GROUPS,
  copyEntry,
  copyProblem,
  copyText,
  DEFAULT_COPY,
  normalizeCopyOverrides,
  normalizeCopyText,
  resolveCopy,
  unknownPlaceholders,
} from '../copy.js'
import { fmt, messages } from '../messages.js'

/**
 * The two promises this module makes, asserted rather than described:
 *
 *   1. nothing configured renders exactly the catalogue, and
 *   2. no stored value — however broken, however large — can reach a page.
 *
 * The second is the one worth the tests. Everything a panel can put in a jsonb column ends
 * up here, and a settings row is not validated by the database.
 */

const idOf = (i: number) => COPY_ENTRIES[i]?.id as string

describe('the registry', () => {
  it('points every entry at a string that is actually in the catalogue', () => {
    for (const entry of COPY_ENTRIES) {
      expect(typeof entry.defaultText, entry.id).toBe('string')
      expect(entry.defaultText.length, entry.id).toBeGreaterThan(0)
      // The default has to fit the field, or the panel opens showing an invalid value.
      expect(
        entry.defaultText.length,
        `${entry.id} default is longer than its own max`,
      ).toBeLessThanOrEqual(entry.max)
      expect(COPY_GROUPS).toContain(entry.group)
    }
  })

  it('declares every placeholder its default uses', () => {
    for (const entry of COPY_ENTRIES) {
      expect(unknownPlaceholders(entry, entry.defaultText), entry.id).toEqual([])
    }
  })

  it('has no duplicate ids', () => {
    const ids = COPY_ENTRIES.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('nothing configured', () => {
  it('is the catalogue, for every shape of missing row', () => {
    for (const raw of [null, undefined, {}, [], 0, 'nonsense', { unrelated: 'x' }]) {
      expect(resolveCopy(raw)).toEqual(DEFAULT_COPY)
    }
  })

  it('resolves to the same object identity when there is nothing to override', () => {
    // Cheap enough to matter: this runs on every request that renders a public page.
    expect(resolveCopy(null)).toBe(DEFAULT_COPY)
    expect(resolveCopy({ 'browse.empty': messages.browse.empty })).toBe(DEFAULT_COPY)
  })

  it('reads the shipped catalogue strings, not a second copy of them', () => {
    expect(DEFAULT_COPY['browse.empty']).toBe(messages.browse.empty)
    expect(DEFAULT_COPY['search.empty']).toBe(messages.search.empty)
    expect(DEFAULT_COPY['premium.pitch']).toBe(messages.premium.pitch)
    expect(DEFAULT_COPY['email.verify.subject']).toBe(messages.email.verify.subject)
    expect(DEFAULT_COPY['layouts.featured']).toBe(messages.layouts.featured)
  })
})

describe('a stored override that would break a page', () => {
  it('falls back when it is empty or only whitespace', () => {
    for (const bad of ['', '   ', '\n\n', '\t']) {
      expect(resolveCopy({ 'browse.empty': bad })['browse.empty']).toBe(messages.browse.empty)
    }
  })

  it('falls back when it is not text at all', () => {
    for (const bad of [null, 42, true, { a: 1 }, ['x']]) {
      expect(resolveCopy({ 'browse.empty': bad })['browse.empty']).toBe(messages.browse.empty)
    }
  })

  it('falls back when 10 KB is pasted into a one-line field', () => {
    const wall = 'x'.repeat(10_240)
    const resolved = resolveCopy({ 'browse.empty': wall })
    expect(resolved['browse.empty']).toBe(messages.browse.empty)
    expect(copyProblem('browse.empty', wall)).toMatchObject({ problem: 'too_long', max: 200 })
  })

  it('falls back when it carries a placeholder the call site never substitutes', () => {
    // `fmt` leaves an unknown token in place, so "Hello {name}" would render literally.
    expect(fmt('Hello {name}', { q: 'x' })).toBe('Hello {name}')
    const resolved = resolveCopy({ 'browse.empty': 'Nothing here, {name}.' })
    expect(resolved['browse.empty']).toBe(messages.browse.empty)
    expect(copyProblem('browse.empty', 'Nothing here, {name}.')).toEqual({
      problem: 'unknown_placeholder',
      token: 'name',
    })
  })

  it('accepts the placeholder that entry does declare, and drops one it does not', () => {
    expect(copyProblem('search.empty', 'Nothing for {q}. Sorry.')).toBeNull()
    expect(copyProblem('search.empty', 'Nothing for {query}.')).toMatchObject({
      problem: 'unknown_placeholder',
    })
  })

  it('lets an override drop a placeholder the default used', () => {
    // Editorially legitimate: "No series found." without echoing the query still renders.
    const resolved = resolveCopy({ 'search.empty': 'Nothing found. Try a shorter title.' })
    expect(resolved['search.empty']).toBe('Nothing found. Try a shorter title.')
    expect(fmt(resolved['search.empty'] as string, { q: 'x' })).toBe(
      'Nothing found. Try a shorter title.',
    )
  })

  it('ignores keys that are not in the registry', () => {
    const resolved = resolveCopy({ 'nav.signOut': 'Log out', 'browse.empty': 'Nothing.' })
    expect(resolved['nav.signOut']).toBeUndefined()
    expect(resolved['browse.empty']).toBe('Nothing.')
    expect(copyProblem('nav.signOut', 'Log out')).toEqual({ problem: 'unknown' })
  })
})

describe('normalisation', () => {
  const single = copyEntry('email.verify.subject')
  const multi = copyEntry('email.verify.intro')

  it('strips control characters, which is how an email subject gets a Bcc header', () => {
    const injected = 'Verify your email\r\nBcc: attacker@example.com'
    const clean = normalizeCopyText(single as never, injected)
    expect(clean).toBe('Verify your email Bcc: attacker@example.com')
    expect(clean).not.toMatch(/[\r\n]/)
    expect(resolveCopy({ 'email.verify.subject': injected })['email.verify.subject']).toBe(clean)
  })

  it('drops NUL and friends rather than passing them through', () => {
    expect(normalizeCopyText(single as never, 'a\u0000b\u0007c\u007f')).toBe('abc')
  })

  it('keeps paragraph breaks in a multiline field and flattens them in a single-line one', () => {
    expect(normalizeCopyText(multi as never, 'one\r\ntwo')).toBe('one\ntwo')
    expect(normalizeCopyText(single as never, 'one\ntwo')).toBe('one two')
  })
})

describe('what gets stored', () => {
  it('drops an override that only restates the shipped string', () => {
    expect(normalizeCopyOverrides({ 'browse.empty': messages.browse.empty })).toEqual({})
  })

  it('keeps only usable, changed values', () => {
    const stored = normalizeCopyOverrides({
      'browse.empty': '  Nothing matches.  ',
      'search.empty': 'x'.repeat(500),
      'comments.empty': '',
      'not.a.key': 'ignored',
    })
    expect(stored).toEqual({ 'browse.empty': 'Nothing matches.' })
  })
})

describe('copyText', () => {
  it('answers with the default for a key the map does not carry', () => {
    expect(copyText({}, idOf(0))).toBe(DEFAULT_COPY[idOf(0)])
    expect(copyText({}, 'not.a.key')).toBe('')
  })
})
