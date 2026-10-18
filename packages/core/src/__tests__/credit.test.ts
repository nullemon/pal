import { describe, expect, it } from 'vitest'
import {
  type CreditSettings,
  creditPageIndex,
  creditSettingsSchema,
  resolveCredit,
} from '../credit.js'

/**
 * What a chapter's credit page says, after the overrides.
 *
 * The precedence is the feature: a chapter note beats the site note, a series background
 * beats the site background, a series overlay beats the site overlay. The case worth pinning
 * is the blank one — clearing a field means "use the default again", which is what an empty
 * box means to the person who cleared it.
 */

const settings = (over: Partial<CreditSettings> = {}): CreditSettings =>
  creditSettingsSchema.parse({
    enabled: true,
    overlays: [
      { id: 'ink', name: 'Ink', key: 'credit/ink.png' },
      { id: 'cosy', name: 'Cosy', key: 'credit/cosy.png' },
    ],
    defaultOverlayId: 'ink',
    defaultBackgroundKey: 'credit/bg-default.jpg',
    roles: [
      { label: 'TYPESETTER', handle: 'NaPal__' },
      { label: 'CLEANER', handle: 'PaPal__' },
    ],
    defaultNote: 'Thanks for reading.',
    discord: 'palscans.org/discord',
    twitter: 'x.com/palscans',
    ...over,
  })

describe('resolveCredit', () => {
  it('uses the site defaults when nothing overrides them', () => {
    const credit = resolveCredit({ settings: settings() })
    expect(credit?.overlayKey).toBe('credit/ink.png')
    expect(credit?.backgroundKey).toBe('credit/bg-default.jpg')
    expect(credit?.note).toBe('Thanks for reading.')
  })

  it('prefers the chapter note over the site note', () => {
    const credit = resolveCredit({ settings: settings(), chapterNote: 'A note for this one.' })
    expect(credit?.note).toBe('A note for this one.')
  })

  it('falls back to the site note when the chapter note is blank', () => {
    // Clearing the box means "use the default again", not "print nothing".
    for (const blank of ['', '   ', null, undefined])
      expect(resolveCredit({ settings: settings(), chapterNote: blank })?.note).toBe(
        'Thanks for reading.',
      )
  })

  it('prefers the series background and overlay', () => {
    const credit = resolveCredit({
      settings: settings(),
      series: { backgroundKey: 'credit/one-piece.jpg', overlayId: 'cosy' },
    })
    expect(credit?.backgroundKey).toBe('credit/one-piece.jpg')
    expect(credit?.overlayKey).toBe('credit/cosy.png')
  })

  it('falls back to the site overlay when the series picked none', () => {
    const credit = resolveCredit({ settings: settings(), series: { overlayId: '  ' } })
    expect(credit?.overlayKey).toBe('credit/ink.png')
  })

  it('drops roles nobody is credited for, rather than printing an empty row', () => {
    const credit = resolveCredit({
      settings: settings({
        roles: [
          { label: 'TYPESETTER', handle: 'NaPal__' },
          { label: 'REDRAWER', handle: '' },
        ],
      }),
    })
    expect(credit?.roles.map((r) => r.label)).toEqual(['TYPESETTER'])
  })

  it('renders nothing at all while the feature is off', () => {
    // It inserts a page into every new chapter; that is not something to switch itself on.
    expect(resolveCredit({ settings: settings({ enabled: false }) })).toBeNull()
  })

  it('renders nothing when the chosen overlay does not exist', () => {
    // A deleted overlay must not leave text floating over a background.
    expect(resolveCredit({ settings: settings({ defaultOverlayId: 'gone' }) })).toBeNull()
    expect(resolveCredit({ settings: settings(), series: { overlayId: 'deleted-one' } })).toBeNull()
  })

  it('allows no background, which is a design choice rather than a failure', () => {
    const credit = resolveCredit({ settings: settings({ defaultBackgroundKey: '' }) })
    expect(credit?.backgroundKey).toBeNull()
    expect(credit?.overlayKey).toBe('credit/ink.png')
  })
})

describe('creditPageIndex', () => {
  it('is the second page of a normal chapter', () => {
    // Second, not first: the cover is what every thumbnail and every shared link shows.
    expect(creditPageIndex(20)).toBe(1)
  })

  it('goes last in a one-page chapter rather than ahead of its only page', () => {
    expect(creditPageIndex(1)).toBe(1)
  })

  it('is absent from a chapter with no pages', () => {
    expect(creditPageIndex(0)).toBeNull()
  })
})

/**
 * Chapters that predate the switch.
 *
 * Turning the feature on must not insert a page into a thousand chapters readers have
 * already read and linked to — that is what "new chapters only" means, and it has to be a
 * line in the data rather than a rule somebody remembers.
 */
describe('the enabled-at cutoff', () => {
  const withCutoff = settings({ enabledAt: '2026-10-18T12:00:00.000Z' })

  it('gives a card to a chapter created after it was switched on', () => {
    expect(
      resolveCredit({ settings: withCutoff, chapterCreatedAt: '2026-10-19T09:00:00.000Z' }),
    ).not.toBeNull()
  })

  it('leaves a chapter from before the switch exactly as it was', () => {
    expect(
      resolveCredit({ settings: withCutoff, chapterCreatedAt: '2026-09-01T09:00:00.000Z' }),
    ).toBeNull()
  })

  it('treats an unknown creation date as old, not new', () => {
    // The failure that matters is inserting a page into an archive nobody asked to change.
    expect(resolveCredit({ settings: withCutoff, chapterCreatedAt: null })).toBeNull()
    expect(resolveCredit({ settings: withCutoff })).toBeNull()
  })

  it('applies to every chapter when no cutoff was stamped', () => {
    expect(resolveCredit({ settings: settings(), chapterCreatedAt: null })).not.toBeNull()
  })

  it('accepts a Date as readily as a string, since the database hands back Dates', () => {
    expect(
      resolveCredit({ settings: withCutoff, chapterCreatedAt: new Date('2026-10-20T00:00:00Z') }),
    ).not.toBeNull()
  })
})
