import { describe, expect, it } from 'vitest'
import { contrast, hexOf } from '../appearance/resolve'
import { parseAppearance } from '../appearance/schema'
import {
  absoluteUrl,
  EMAIL_SURFACE,
  emailPalette,
  resolveEmailTheme,
  SHIPPED_BUTTON,
  safeColor,
} from './theme'

/**
 * The three rules a themed mail has to keep, none of which a browser would have enforced for
 * us: the button stays legible whatever colour the operator picked, every URL is absolute,
 * and a colour cannot escape the `style` attribute it is interpolated into.
 */

const doc = (accent: string) => parseAppearance({ color: { accent } })

const theme = (over: Partial<Parameters<typeof resolveEmailTheme>[0]> = {}) =>
  resolveEmailTheme({
    siteName: 'Scanlations',
    siteUrl: 'https://palscans.org',
    markVersion: '1abcde',
    appearance: null,
    ...over,
  })

describe('the button, on whatever colour the operator picked', () => {
  /**
   * The picker will hand us anything: the presets, an eyedropper on a screenshot, a pasted
   * brand hex. Every one of them has to end up with readable text on the button, so this
   * walks the whole space rather than a handful of favourites.
   */
  it('holds its text to 4.5:1 across the colour space', () => {
    const failures: string[] = []
    for (let h = 0; h < 360; h += 15) {
      for (const l of [0.15, 0.3, 0.5, 0.7, 0.9]) {
        for (const c of [0.02, 0.1, 0.25]) {
          const accent = hexOf({ l, c, h })
          const p = emailPalette(doc(accent))
          if (contrast(p.ink, p.accent) < 4.5)
            failures.push(`${accent} → ${p.accent} / ${p.ink} = ${contrast(p.ink, p.accent)}`)
          // …and the button still reads as a button against the card it sits on. The site's
          // resolver aims the accent at 3:1 over its *own* tinted ground; the mail's ground
          // is the fixed one, so the honest floor here is a shade lower.
          if (contrast(p.accent, EMAIL_SURFACE.page) < 2.5)
            failures.push(`${accent} → ${p.accent} vanishes into the page`)
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('prints near-black on a yellow, not the white a template would have hard-coded', () => {
    const p = emailPalette(doc('#fffb00'))
    expect(p.accent).toBe('#fffb00')
    expect(p.ink).not.toBe('#ffffff')
    expect(contrast(p.ink, p.accent)).toBeGreaterThanOrEqual(4.5)
  })

  it('lifts an accent too dark to be a button rather than sending an invisible one', () => {
    const p = emailPalette(doc('#1a1a2e'))
    expect(contrast(p.accent, EMAIL_SURFACE.card)).toBeGreaterThanOrEqual(2.5)
    expect(contrast(p.ink, p.accent)).toBeGreaterThanOrEqual(4.5)
  })

  it('leaves the shipped violet exactly where it is', () => {
    // A site that publishes a theme without touching the accent must not see its mail change
    // colour. `#fff` becomes `#ffffff` — the same white, spelled the way the resolver spells
    // it — and nothing else moves.
    const p = emailPalette(doc('#7c3aed'))
    expect(p.accent).toBe(SHIPPED_BUTTON.accent)
    expect(p.ink).toBe('#ffffff')
  })
})

describe('the mark', () => {
  it('is an absolute URL at the site, and a raster', () => {
    // Not the CDN: the icon route reads the object with the server's own credentials, so the
    // logo loads in a stranger's inbox even when the bucket is private.
    expect(theme().logo).toBe('https://palscans.org/brand/1abcde/apple-touch-icon.png')
    expect(theme().logo).not.toMatch(/\.svg/)
  })

  it('joins a SITE_URL with a trailing slash exactly once', () => {
    expect(theme({ siteUrl: 'https://palscans.org/' })?.logo).toBe(
      'https://palscans.org/brand/1abcde/apple-touch-icon.png',
    )
  })

  it('is absent when the operator has chosen no mark', () => {
    // Not a placeholder, not the shipped monogram: a broken image in a password-reset mail is
    // worse than a masthead that is only the site name, which is what this has always been.
    expect(theme({ markVersion: null }).logo).toBeNull()
  })

  it('is dropped rather than emitted relative when SITE_URL is not an origin', () => {
    expect(theme({ siteUrl: '/palscans' }).logo).toBeNull()
    expect(theme({ siteUrl: '' }).logo).toBeNull()
    expect(absoluteUrl('palscans.org', '/brand/x/y.png')).toBeNull()
  })
})

describe('with no theme published', () => {
  it('sends the button the site shipped with', () => {
    expect(theme({ appearance: null })).toMatchObject({ ...SHIPPED_BUTTON })
  })
})

describe('a colour that tries to leave its style attribute', () => {
  it('is refused by safeColor, whatever shape it arrives in', () => {
    expect(safeColor('#fff" onmouseover="alert(1)', '#7c3aed')).toBe('#7c3aed')
    expect(safeColor('red;}</style><script>alert(1)</script>', '#7c3aed')).toBe('#7c3aed')
    expect(safeColor('#ffff', '#7c3aed')).toBe('#7c3aed')
    expect(safeColor('  #FFF000 ', '#7c3aed')).toBe('#fff000')
  })

  it('never reaches the theme, even from a hand-edited settings row', () => {
    const poisoned = resolveEmailTheme({
      siteName: 'Scanlations',
      siteUrl: 'https://palscans.org',
      markVersion: null,
      appearance: { color: { accent: '#fff" onmouseover="alert(1)' } },
    })
    expect(poisoned.accent).toBe(SHIPPED_BUTTON.accent)
    expect(poisoned.ink).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('is still a hex after every derivation the resolver does to it', () => {
    for (const accent of ['#000000', '#ffffff', '#808080', '#12a594']) {
      const p = emailPalette(doc(accent))
      expect(p.accent).toMatch(/^#[0-9a-f]{6}$/)
      expect(p.ink).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})
