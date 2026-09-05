import { describe, expect, it } from 'vitest'
import { COPY_ENTRIES, copyFn, DEFAULT_COPY, resolveCopy } from '../copy.js'

/**
 * Operator copy is stored as a loose JSON document and rendered on public pages. A stored
 * value therefore has to be treated as hostile — not because the operator is, but because a
 * rolled-back deploy, a hand-edited row or a paste accident all reach the same code path,
 * and a page that throws is worse than a page showing the shipped wording.
 *
 * These probe the resolver directly rather than the screen that is meant to prevent bad
 * input, on the grounds that the screen is not the only way a row gets written.
 */
const first = COPY_ENTRIES[0]
if (!first) throw new Error('the copy registry is empty')

describe('a stored document that is not what the type says', () => {
  it('never throws, and never returns a non-string, whatever it is handed', () => {
    for (const junk of [
      null,
      undefined,
      42,
      'a string',
      [],
      [{ id: 'x' }],
      { [first.id]: 42 },
      { [first.id]: null },
      { [first.id]: {} },
      { [first.id]: ['a'] },
      { [first.id]: true },
      Object.create({ inherited: 'x' }),
    ]) {
      const copy = copyFn(resolveCopy(junk))
      for (const entry of COPY_ENTRIES) expect(typeof copy(entry.id), entry.id).toBe('string')
    }
  })

  it('falls back to the shipped wording for every entry when nothing is set', () => {
    for (const entry of COPY_ENTRIES)
      expect(copyFn(resolveCopy({}))(entry.id), entry.id).toBe(DEFAULT_COPY[entry.id])
  })

  it('treats an empty or whitespace value as "reset", not as an empty page', () => {
    for (const blank of ['', '   ', '\n\n', '\t'])
      expect(copyFn(resolveCopy({ [first.id]: blank }))(first.id)).toBe(DEFAULT_COPY[first.id])
  })

  it('refuses a value long enough to break a layout', () => {
    const huge = 'x'.repeat(50_000)
    expect(copyFn(resolveCopy({ [first.id]: huge }))(first.id)).toBe(DEFAULT_COPY[first.id])
  })

  it('strips the control characters that would forge an email header', () => {
    const injected = 'Subject line\r\nBcc: victim@example.com'
    const out = copyFn(resolveCopy({ [first.id]: injected }))(first.id)
    expect(out).not.toMatch(/[\r\n]/)
  })

  it('ignores ids that are not in the registry', () => {
    const copy = copyFn(resolveCopy({ 'not.a.real.id': 'hello', __proto__: { polluted: 'yes' } }))
    expect(copy('not.a.real.id')).toBe('')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('keeps a legitimate edit', () => {
    expect(copyFn(resolveCopy({ [first.id]: 'A genuinely edited line.' }))(first.id)).toBe(
      'A genuinely edited line.',
    )
  })
})
