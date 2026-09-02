import { describe, expect, it } from 'vitest'
import { DEFAULT_COMMENT_SETTINGS, parseCommentSettings } from '../settings'

describe('parseCommentSettings', () => {
  it('merges table rows over the docs/14 defaults and drops junk', () => {
    const s = parseCommentSettings({
      edit_window_minutes: 30,
      rate_limits: { per_minute: 9 },
      collapse_threshold: 'x',
    })
    expect(s.edit_window_minutes).toBe(30)
    expect(s.rate_limits.per_minute).toBe(9)
    expect(s.rate_limits.per_hour).toBe(60)
    expect(s.collapse_threshold).toBe(DEFAULT_COMMENT_SETTINGS.collapse_threshold)
    expect(s.hold_links).toBe(true)
  })
})
