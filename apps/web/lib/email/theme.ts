import { getDb, publishedAppearance } from '@palscans/db'
import { unstable_cache } from 'next/cache'
import { contrast, inkOn, readableSwatch, resolveAppearance } from '../appearance/resolve'
import { DEFAULT_APPEARANCE, parseAppearance } from '../appearance/schema'
import { iconHref } from '../chrome/icons'
import { brandIcons, siteChrome } from '../chrome/load'
import { getEnv } from '../env'

/**
 * The theme every transactional mail wears (docs/15 "Email theme"): the operator's mark,
 * their accent, and the name in the masthead. Nothing here is a new setting — the three
 * values come from the three documents that already own them:
 *
 * | in the mail | comes from | edited in |
 * |---|---|---|
 * | masthead name | `settings.site.name` → `siteChrome().brand.name` | Appearance → Brand |
 * | masthead mark | `settings.brand` → the generated icon set | Appearance → Brand |
 * | button + rule | `appearance_settings.color.accent` | Appearance → Theme |
 *
 * The footer line is the fourth part of the theme and is not here: it is *copy*, so it lives
 * in the copy registry (`email.footer` in `@palscans/core/copy`) with the subjects and
 * intros, and `./templates.ts` resolves it through the same `CopyFn` they use.
 *
 * ## Why the mark is a generated PNG served by the app
 *
 * A mail client is not a browser, and three of its rules decide this file:
 *
 * 1. **No SVG.** Gmail strips `<svg>` and refuses `image/svg+xml` in an `<img>`; the operator
 *    may well have uploaded exactly that. So the mail links the *generated* raster from
 *    `/brand/<version>/apple-touch-icon.png` — the same pipeline the favicon uses
 *    (`lib/chrome/icons.ts`), which rasterises a preset or an uploaded monogram, SVG or not.
 * 2. **Absolute, or dead.** A relative `src` resolves against nothing in a mail client, so
 *    the URL is joined to `SITE_URL`; if `SITE_URL` is not an absolute http(s) origin the
 *    logo is dropped rather than emitted broken.
 * 3. **It must load for a stranger.** The icon route reads the object with the *server's*
 *    storage credentials and answers the bytes itself, so a private bucket — or an S3 that
 *    only signs time-limited URLs — still sends a mail whose logo loads. Pointing at
 *    `storageUrl(brand.logo_dark.key)` would have been one line and would have produced a
 *    broken image for every operator whose bucket is not world-readable, and a *relative*
 *    `/_storage/…` URL for every operator on the fs driver.
 *
 * The `apple-touch-icon` size is the opaque one (180px on the operator's chosen square):
 * a transparent mark inverted by a dark-mode client can vanish, while a mark on its own tile
 * cannot. It is displayed at 48px, so it is sharp on a retina phone.
 *
 * **With no preset picked and no monogram uploaded there is no mark and the masthead is the
 * name alone** — exactly what the mail has always been. A wordmark uploaded to `logo_dark`
 * on its own does not produce one either: it has no generated raster, and rule 3 rules out
 * linking the upload. A broken image in a password-reset mail is worse than no image.
 */

/**
 * The mail's own ground. Fixed, not derived: an email is read in a client whose own
 * background is out of our hands, and these five values are what the four templates have
 * always used. The accent is the one colour the operator moves.
 */
export const EMAIL_SURFACE = {
  page: '#100d17',
  card: '#181423',
  line: '#2c2540',
  ink: '#ece9f4',
  muted: '#9e97b8',
} as const

/** The button as it shipped, and what an unconfigured site still sends. */
export const SHIPPED_BUTTON = { accent: '#7c3aed', ink: '#fff' } as const

/** Rendered width and height of the masthead mark, in CSS pixels. */
export const EMAIL_LOGO_PX = 48

export interface EmailTheme {
  /** The operator's site name, for the masthead and the `{site}` in the footer line. */
  siteName: string
  /** Absolute PNG URL, or null when no mark is configured. */
  logo: string | null
  /** Button background and the top rule. */
  accent: string
  /** Text on `accent` — computed, never assumed to be white. */
  ink: string
}

const HEX = /^#[0-9a-f]{6}$/i

/**
 * The last gate before a colour is interpolated into a `style` attribute.
 *
 * Everything upstream already constrains these — the schema's `hex` regex, then culori's
 * `formatHex` — so this can only fire on a value that arrived some other way. It is here
 * because the cost is one regex and the failure it prevents is
 * `style="background:red" onmouseover="…"` in a mail that asks people to click a
 * password-reset button.
 */
export const safeColor = (value: string, fallback: string): string =>
  HEX.test(value.trim()) ? value.trim().toLowerCase() : fallback

/**
 * The button's background and its text colour, from the operator's accent.
 *
 * Two steps, both borrowed rather than reinvented (`lib/appearance/resolve.ts`):
 *
 * 1. The accent is run through the site's own resolver and the *dark theme* `--color-brand`
 *    is taken. That is the colour the site's own buttons are, already nudged to 3:1 against
 *    the dark ground the mail also uses — so the mail and the site agree, and a very dark
 *    accent does not become an invisible button on the card.
 * 2. `inkOn()` picks white or near-black by measured contrast. If neither clears 4.5:1 on
 *    that swatch — white on `#fffb00` is 1.1:1, and an operator can pick `#fffb00` —
 *    `readableSwatch()` lifts the swatch until one of them does, and the ink is re-picked.
 *    Lifting rather than darkening because the mail's ground is dark: a lighter button stays
 *    visible on the card, a darker one disappears into it.
 */
export const emailPalette = (doc = DEFAULT_APPEARANCE): { accent: string; ink: string } => {
  const brand = safeColor(resolveAppearance(doc).ramp.brand, SHIPPED_BUTTON.accent)
  const direct = inkOn(brand)
  if (contrast(direct, brand) >= 4.5) return { accent: brand, ink: safeColor(direct, '#ffffff') }
  const lifted = safeColor(readableSwatch(brand, 1), SHIPPED_BUTTON.accent)
  return { accent: lifted, ink: safeColor(inkOn(lifted), '#ffffff') }
}

export interface EmailThemeInput {
  siteName: string
  /** `SITE_URL`. A logo is only emitted when this is an absolute http(s) origin. */
  siteUrl: string
  /** The generated icon set's version segment, or null when no mark is configured. */
  markVersion: string | null
  /** The published appearance document as stored, or null when nothing is published. */
  appearance: unknown
}

/** `SITE_URL` + a site path. Null when `SITE_URL` is not an absolute http(s) origin. */
export const absoluteUrl = (siteUrl: string, path: string): string | null => {
  if (!/^https?:\/\/[^/]/i.test(siteUrl.trim())) return null
  return `${siteUrl.trim().replace(/\/+$/, '')}${path}`
}

/**
 * Pure: the four values the templates render. Total by construction — a corrupt appearance
 * row, a missing mark or a nonsense `SITE_URL` each degrade to the mail as it shipped rather
 * than to a broken one.
 *
 * `appearance: null` (nothing published) returns the shipped `#7c3aed` / `#fff` verbatim, so
 * a site that has never opened Appearance → Theme sends byte-for-byte the button it always
 * did.
 */
export const resolveEmailTheme = (input: EmailThemeInput): EmailTheme => {
  const palette =
    input.appearance == null ? SHIPPED_BUTTON : emailPalette(parseAppearance(input.appearance))
  return {
    siteName: input.siteName,
    logo: input.markVersion
      ? absoluteUrl(input.siteUrl, iconHref(input.markVersion, 'apple-touch-icon.png'))
      : null,
    accent: palette.accent,
    ink: palette.ink,
  }
}

/**
 * The published appearance document, cached for 60s under the `appearance` tag that
 * Appearance → Theme's publish already purges — the same contract
 * `lib/appearance/AppearanceStyle.tsx` reads the token block under. Null when nothing is
 * published *or* when the database is away, which is the same answer: send the shipped mail.
 */
const cachedAppearanceDoc = unstable_cache(
  async (): Promise<unknown> => {
    try {
      return (await publishedAppearance(await getDb()))?.settings ?? null
    } catch {
      return null
    }
  },
  ['email', 'appearance'],
  { revalidate: 60, tags: ['appearance'] },
)

/** Never throws: every source falls back to what the mail shipped with. */
const attempt = async <T>(read: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await read()
  } catch {
    return fallback
  }
}

/**
 * The theme for a mail about to be sent. Three cached reads, so a verification mail costs no
 * query the page shell was not already making, and each falls back on its own: a database
 * that is away means the mail goes out in the shipped livery, never that it does not go out.
 */
export const emailTheme = async (): Promise<EmailTheme> => {
  // Unguarded, as `link()` in ./templates.ts has always been: a process whose environment
  // does not parse cannot send a mail with a working link either.
  const env = getEnv()
  const [siteName, icons, appearance] = await Promise.all([
    attempt(async () => (await siteChrome()).brand.name, env.SITE_NAME),
    attempt(async () => await brandIcons(), null),
    attempt(async () => await cachedAppearanceDoc(), null),
  ])
  return resolveEmailTheme({
    siteName,
    siteUrl: env.SITE_URL,
    markVersion: icons?.version ?? null,
    appearance,
  })
}
