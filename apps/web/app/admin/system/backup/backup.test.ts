import { describe, expect, it } from 'vitest'
import { formatBytes, formatDuration } from './shared'

/**
 * The two things the Backup screen renders that are worth being sure about: an operator
 * reading "537989" instead of "525.4 KB" cannot tell at a glance whether the dump is the
 * right size, and a duration that rounds to "0s" hides a run that took two minutes.
 */

describe('formatBytes', () => {
  it('scales to the unit that reads', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(537_989)).toBe('525.4 KB')
    expect(formatBytes(1024 * 1024 * 3.5)).toBe('3.5 MB')
    expect(formatBytes(1024 ** 3 * 2)).toBe('2.0 GB')
  })

  it('shows an em dash rather than "0 B" when there is no dump', () => {
    expect(formatBytes(null)).toBe('—')
    expect(formatBytes(undefined)).toBe('—')
  })
})

describe('formatDuration', () => {
  it('keeps sub-second runs honest and reads minutes as minutes', () => {
    expect(formatDuration(371)).toBe('371ms')
    expect(formatDuration(2131)).toBe('2.1s')
    expect(formatDuration(95_000)).toBe('1m 35s')
    expect(formatDuration(null)).toBe('—')
  })
})
