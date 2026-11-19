import { describe, expect, it } from 'vitest'
import { adSlot, adsSettingsSchema, DEFAULT_ADS } from '@/components/discovery/settings'
import { DEFAULT_READER_SITE_SETTINGS, parseReaderSiteSettings } from './settings'

/**
 * The anchor ad's tag has to survive the trip from `settings.ads` to the component, twice.
 *
 * `mobile_anchor` is one slot read by two unrelated loaders: the reader builds its own
 * settings document (`parseReaderSiteSettings`), and the discovery pages read the shared one
 * (`adsSettingsSchema`). A slot added to one and not the other is the exact failure this
 * placement already had — it sat in the admin list, accepted a tag, and rendered nowhere,
 * so the settings screen reported a live placement that earned nothing. These assert that
 * both loaders can actually see it.
 */

const tag = '<script src="https://network.example/anchor.js"></script>'

describe('mobile_anchor through the reader loader', () => {
  it('carries the tag', () => {
    const parsed = parseReaderSiteSettings({}, { slots: { mobile_anchor: { enabled: true, tag } } })
    expect(parsed.tags.anchor).toBe(tag)
  })

  it('is null when the operator has not configured it', () => {
    expect(parseReaderSiteSettings({}, {}).tags.anchor).toBeNull()
    expect(DEFAULT_READER_SITE_SETTINGS.tags.anchor).toBeNull()
  })

  it('leaves the other reader slots alone', () => {
    // A regression guard with teeth: the anchor was added to the same zod object as the
    // three reader slots, and a typo in that object silently nulls its neighbours rather
    // than failing, because every slot falls back to null by design.
    const parsed = parseReaderSiteSettings(
      {},
      {
        slots: {
          reader_sky: { enabled: true, tag: 'sky' },
          reader_instrip: { enabled: true, tag: 'instrip' },
          reader_end: { enabled: true, tag: 'end' },
          mobile_anchor: { enabled: true, tag },
        },
      },
    )
    expect(parsed.tags).toEqual({ sky: 'sky', instrip: 'instrip', end: 'end', anchor: tag })
  })

  it('survives a malformed row rather than taking the reader down', () => {
    expect(
      parseReaderSiteSettings({}, { slots: { mobile_anchor: 'nonsense' } }).tags.anchor,
    ).toBeNull()
  })
})

describe('mobile_anchor through the discovery loader', () => {
  it('carries the tag', () => {
    const ads = adsSettingsSchema.parse({ slots: { mobile_anchor: { enabled: true, tag } } })
    expect(adSlot(ads, 'mobile_anchor')).toEqual({ enabled: true, tag })
  })

  it('defaults to on with no tag, so an unconfigured slot renders nothing', () => {
    // `enabled: true` and `tag: null` together are what make `AnchorAd` render nothing at
    // all: it is the tag, not the switch, that decides whether a bar appears.
    expect(adSlot(DEFAULT_ADS, 'mobile_anchor')).toEqual({ enabled: true, tag: null })
  })

  it('keeps the slot when a sibling is malformed', () => {
    const ads = adsSettingsSchema.parse({
      slots: { home_top: 'nonsense', mobile_anchor: { enabled: true, tag } },
    })
    expect(adSlot(ads, 'mobile_anchor').tag).toBe(tag)
  })
})
