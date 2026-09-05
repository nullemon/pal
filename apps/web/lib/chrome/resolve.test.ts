import { describe, expect, it } from 'vitest'
import { DEFAULT_CHROME } from '@/lib/site'
import { announcementId, resolveChrome } from './resolve'

/**
 * The contract the whole feature rests on: **an operator who has configured nothing sees the
 * site exactly as it shipped.** Everything below is either that promise, or the rule for what
 * happens when one field is set and the rest are not.
 */

const url = (key: string) => `/_storage/${key}`
const resolve = (input: Partial<Parameters<typeof resolveChrome>[0]> = {}) =>
  resolveChrome({ site: null, brand: null, menus: null, assetUrl: url, ...input })

describe('nothing configured', () => {
  it('is the shipped chrome, field for field', () => {
    expect(resolve()).toEqual(DEFAULT_CHROME)
  })

  it('is the shipped chrome for empty rows too', () => {
    expect(resolve({ site: {}, brand: {}, menus: {} })).toEqual(DEFAULT_CHROME)
  })

  it('survives rows of the wrong shape entirely', () => {
    expect(resolve({ site: 'nonsense', brand: 42, menus: [1, 2, 3] })).toEqual(DEFAULT_CHROME)
  })

  /**
   * The seeded `menus` row has existed since long before anything read it, and its links had
   * drifted from the chrome the site actually rendered. Honouring it on the first deploy would
   * take links out of every existing install's footer — so a row from before this screen
   * existed, recognisable by having none of the fields the screen writes, is ignored until
   * somebody saves.
   */
  it('ignores a menus row written before this screen existed', () => {
    const seeded = {
      header: [{ label: 'Home', href: '/', mobile: true }],
      primary_button: { label: 'Premium', href: '/premium' },
      footer: [{ title: 'Browse', links: [{ label: 'Latest updates', href: '/' }] }],
      bottom_nav: ['home', 'browse', 'bookmarks', 'account'],
    }
    expect(resolve({ menus: seeded })).toEqual(DEFAULT_CHROME)
  })

  it('honours the same row once one of the new fields is present', () => {
    const saved = {
      header: [{ label: 'Home', href: '/', mobile: true }],
      copyright: '© 2027 Somebody',
    }
    const chrome = resolve({ menus: saved })
    expect(chrome.header).toEqual([{ label: 'Home', href: '/', prefix: false, mobile: true }])
    expect(chrome.copyright).toBe('© 2027 Somebody')
  })
})

describe('brand', () => {
  it('takes the name and tagline from settings.site — the row Admin → Settings writes', () => {
    const chrome = resolve({ site: { name: 'Toonbase', tagline: 'Webtoons, daily.' } })
    expect(chrome.brand.name).toBe('Toonbase')
    expect(chrome.brand.tagline).toBe('Webtoons, daily.')
  })

  it('falls back to the shipped name when the row has none', () => {
    expect(resolve({ site: { name: '   ' } }).brand.name).toBe(DEFAULT_CHROME.brand.name)
  })

  it('keeps an intentionally empty tagline empty', () => {
    expect(resolve({ site: { tagline: '' } }).brand.tagline).toBe('')
  })

  it('resolves upload keys to URLs and carries their intrinsic size', () => {
    const chrome = resolve({
      brand: {
        wordmark: 'logo',
        logo_dark: { key: 'brand/logo_dark-abc123abc123.png', width: 320, height: 64 },
      },
    })
    expect(chrome.brand.wordmark).toBe('logo')
    expect(chrome.brand.logoDark).toEqual({
      url: '/_storage/brand/logo_dark-abc123abc123.png',
      width: 320,
      height: 64,
    })
    expect(chrome.brand.logoLight).toBeNull()
  })

  it('carries the chosen logo direction, and keeps the upload alongside it', () => {
    // A preset and an upload are two sources for one setting: the preset wins for rendering,
    // and the upload survives so switching back does not mean uploading it again.
    const chrome = resolve({
      brand: {
        logo_preset: '03-twin-bookmark',
        logo_dark: { key: 'brand/logo_dark-abc123abc123.png', width: 320, height: 64 },
      },
    })
    expect(chrome.brand.logoPreset).toBe('03-twin-bookmark')
    expect(chrome.brand.logoDark?.url).toBe('/_storage/brand/logo_dark-abc123abc123.png')
  })

  it('ignores a preset id that is not one of the ten', () => {
    expect(resolve({ brand: { logo_preset: '99-nope' } }).brand.logoPreset).toBeNull()
  })

  it('refuses an asset key outside the brand prefix', () => {
    // A hand-edited row must not be able to point the site's logo at any object in the bucket.
    const chrome = resolve({
      brand: { logo_dark: { key: 'pages/1/2/0001.avif', width: 10, height: 10 } },
    })
    expect(chrome.brand.logoDark).toBeNull()
  })
})

describe('header links', () => {
  it('replaces the shipped links, in order, keeping the mobile flag', () => {
    const chrome = resolve({
      menus: {
        header: [
          { label: 'Read', href: '/browse', prefix: true, mobile: true },
          { label: 'News', href: '/announcements' },
        ],
      },
    })
    expect(chrome.header).toEqual([
      { label: 'Read', href: '/browse', prefix: true, mobile: true },
      { label: 'News', href: '/announcements', prefix: false, mobile: false },
    ])
  })

  it('honours an empty list — an operator may want no header nav', () => {
    expect(resolve({ menus: { header: [] } }).header).toEqual([])
  })

  it('drops one bad link rather than the whole nav', () => {
    const chrome = resolve({
      menus: {
        header: [
          { label: 'Read', href: '/browse' },
          { label: 'Bad', href: 'javascript:alert(1)' },
        ],
      },
    })
    expect(chrome.header.map((l) => l.label)).toEqual(['Read'])
  })

  it('falls back when every link is malformed', () => {
    const chrome = resolve({ menus: { header: [{ nope: true }, 7] } })
    expect(chrome.header).toEqual(DEFAULT_CHROME.header)
  })
})

describe('primary button', () => {
  it('takes the operator label and target', () => {
    const chrome = resolve({
      menus: { primary_button: { enabled: true, label: 'Support us', href: '/support' } },
    })
    expect(chrome.primaryButton).toEqual({ label: 'Support us', href: '/support' })
  })

  it('disappears when switched off', () => {
    const chrome = resolve({
      menus: { primary_button: { enabled: false, label: 'Premium', href: '/subscribe' } },
    })
    expect(chrome.primaryButton).toBeNull()
  })
})

describe('footer and bottom nav', () => {
  it('takes up to four columns', () => {
    const columns = [1, 2, 3, 4, 5].map((n) => ({ title: `C${n}`, links: [] }))
    expect(resolve({ menus: { footer: columns } }).footer).toHaveLength(4)
  })

  it('honours an empty footer', () => {
    expect(resolve({ menus: { footer: [] } }).footer).toEqual([])
  })

  it('builds the bottom nav from ids, deduplicated and capped at four', () => {
    const chrome = resolve({
      menus: { bottom_nav: ['search', 'search', 'home', 'genres', 'history', 'rankings'] },
    })
    expect(chrome.bottomNav.map((i) => i.id)).toEqual(['search', 'home', 'genres', 'history'])
    expect(chrome.bottomNav[0]?.href).toBe('/search')
  })

  it("accepts the seeded row's `account` as the id it later became", () => {
    const chrome = resolve({ menus: { bottom_nav: ['home', 'account'] } })
    expect(chrome.bottomNav.map((i) => i.id)).toEqual(['home', 'profile'])
  })

  it('falls back when the ids are all unknown', () => {
    expect(resolve({ menus: { bottom_nav: ['nope', 'also-nope'] } }).bottomNav).toEqual(
      DEFAULT_CHROME.bottomNav,
    )
  })
})

describe('community', () => {
  it('reads the Discord invite from settings.site when menus has no community block', () => {
    const chrome = resolve({ site: { discord_url: 'https://discord.gg/other' } })
    expect(chrome.community.discordUrl).toBe('https://discord.gg/other')
  })

  it('lets the menus block override, and drop, a network', () => {
    const chrome = resolve({
      site: { discord_url: 'https://discord.gg/other' },
      menus: {
        community: {
          discord_url: null,
          socials: { x: 'https://x.com/new', instagram: '', reddit: null },
          support: { kofi: 'https://ko-fi.com/pal' },
          rss: true,
        },
      },
    })
    expect(chrome.community.discordUrl).toBeNull()
    expect(chrome.community.socials).toEqual([
      { network: 'x', label: 'X', href: 'https://x.com/new' },
    ])
    expect(chrome.community.support).toEqual([
      { network: 'kofi', label: 'Ko-fi', href: 'https://ko-fi.com/pal' },
    ])
    expect(chrome.community.rss).toBe(true)
  })

  it('uses the seeded settings.site socials when menus has none', () => {
    const chrome = resolve({ site: { socials: { x: 'https://x.com/seeded' } } })
    expect(chrome.community.socials.find((s) => s.network === 'x')?.href).toBe(
      'https://x.com/seeded',
    )
    // The networks the seeded row does not name still fall back to the shipped links.
    expect(chrome.community.socials).toHaveLength(5)
  })
})

describe('copyright and attribution', () => {
  it('takes both lines', () => {
    const chrome = resolve({ menus: { copyright: '© 2027 Toonbase', attribution: 'Scans by us' } })
    expect(chrome.copyright).toBe('© 2027 Toonbase')
    expect(chrome.attribution).toBe('Scans by us')
  })

  it('has no attribution line by default', () => {
    expect(resolve().attribution).toBeNull()
  })
})

describe('announcement bar', () => {
  const bar = (extra: Record<string, unknown>) => ({
    menus: { announcement: { enabled: true, text: 'Server move Sunday', ...extra } },
  })

  it('is null until it is switched on', () => {
    expect(resolve({ menus: { announcement: { enabled: false, text: 'hi' } } }).announcement).toBe(
      null,
    )
  })

  it('is null when switched on with no text', () => {
    expect(resolve({ menus: { announcement: { enabled: true, text: '  ' } } }).announcement).toBe(
      null,
    )
  })

  it('renders with its tone, audience and dismissibility', () => {
    const chrome = resolve(bar({ tone: 'warning', audience: 'members', dismissible: false }))
    expect(chrome.announcement).toMatchObject({
      text: 'Server move Sunday',
      tone: 'warning',
      audience: 'members',
      dismissible: false,
    })
  })

  it('falls back to a safe tone and audience when the row names nonsense', () => {
    const chrome = resolve(bar({ tone: 'chartreuse', audience: 'admins' }))
    expect(chrome.announcement).toMatchObject({ tone: 'info', audience: 'everyone' })
  })

  it('is hidden before it starts and after it ends', () => {
    const window = { starts_at: '2026-01-10T00:00:00.000Z', ends_at: '2026-01-20T00:00:00.000Z' }
    const at = (iso: string) => resolve({ ...bar(window), now: new Date(iso) }).announcement
    expect(at('2026-01-09T23:59:00.000Z')).toBeNull()
    expect(at('2026-01-15T12:00:00.000Z')).not.toBeNull()
    expect(at('2026-01-20T00:00:01.000Z')).toBeNull()
  })

  it('treats an open-ended schedule as running', () => {
    const chrome = resolve({
      ...bar({ starts_at: '2020-01-01T00:00:00.000Z', ends_at: null }),
      now: new Date('2026-06-01T00:00:00.000Z'),
    })
    expect(chrome.announcement).not.toBeNull()
  })

  it('changes its dismissal id when the message or tone changes', () => {
    expect(announcementId('a', 'info')).not.toBe(announcementId('b', 'info'))
    expect(announcementId('a', 'info')).not.toBe(announcementId('a', 'promo'))
    expect(announcementId('a', 'info')).toBe(announcementId('a', 'info'))
  })
})
