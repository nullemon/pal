import { BUILTIN_CREDIT_OVERLAYS, creditSettingsSchema, resolveCredit } from '@palscans/core/credit'
import { describe, expect, it } from 'vitest'
import { renderCreditPage } from './render'

/**
 * The card that ships with the site.
 *
 * This exists because of a real afternoon: the feature switched on, every name filled in,
 * and `overlays: []` in the database, so every chapter rendered without a credit page and
 * nothing anywhere said why. The renderer refusing to draw with no artwork is correct; a
 * fresh install having no artwork was the mistake. A shipped card closes it, and this is
 * the test that keeps it closed — the file is easy to move and nothing else would notice.
 */

/** Storage with nothing in it: a site on its first day. */
const empty = { get: async () => null } as never

describe('the built-in card', () => {
  it('resolves with nothing uploaded', () => {
    const credit = resolveCredit({ settings: creditSettingsSchema.parse({ enabled: true }) })
    expect(credit).not.toBeNull()
    expect(credit?.overlayKey).toBe(BUILTIN_CREDIT_OVERLAYS[0]?.key)
  })

  it('renders from the application, not from storage', async () => {
    const credit = resolveCredit({ settings: creditSettingsSchema.parse({ enabled: true }) })
    if (!credit) throw new Error('no credit')
    const out = await renderCreditPage(credit, empty)
    // A JPEG, and a big enough one to be the card rather than an empty canvas.
    expect(out?.byteLength ?? 0).toBeGreaterThan(20_000)
  }, 60_000)

  it('does not read files outside its own folder', async () => {
    // The key comes from an operator-written settings row. `builtin:../../.env` reading a
    // file off the disk is not a trade worth making for a convenience.
    const escaped = await renderCreditPage(
      {
        overlayKey: 'builtin:../../../.env',
        backgroundKey: null,
        font: 'plain',
        roles: [],
        note: '',
        discord: '',
        twitter: '',
      },
      empty,
    )
    expect(escaped).toBeNull()
  })
})
