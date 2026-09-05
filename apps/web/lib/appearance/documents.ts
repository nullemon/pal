import 'server-only'

import { COPY_SETTING_KEY, type CopyOverrides, normalizeCopyOverrides } from '@palscans/core/copy'
import {
  FORMATTING_SETTING_KEY,
  type FormattingSettings,
  parseFormatting,
} from '@palscans/core/formatting'
import type { Db } from '@palscans/db'
import { getSetting, publishedAppearance, putSetting } from '@palscans/db'
import { z } from 'zod'
import { menusFromChrome } from '@/lib/chrome/form'
import { resolveChrome } from '@/lib/chrome/resolve'
import {
  BRAND_SLOTS,
  type BrandSlot,
  brandSettingSchema,
  DEFAULT_BRAND_SETTING,
  type MenusSetting,
  menusSettingSchema,
} from '@/lib/chrome/schema'
import { loadSeoSettings, saveSeoSetting } from '@/lib/seo/settings'
import { DEFAULT_CHROME } from '@/lib/site'
import { getStorage, storageUrl } from '@/lib/storage'
import { resolveAppearance } from './resolve'
import { type AppearanceDoc, DEFAULT_APPEARANCE, parseAppearance } from './schema'
import type { AppearanceScope } from './scope'

/**
 * What each Appearance screen's *document* is, how it is read out of the live site, and how
 * publishing a version puts it back (docs/15 "Presets, preview, history").
 *
 * ## Where the live state lives, and why it did not move
 *
 * The theme is the odd one out: its published `appearance_settings` row **is** what `<head>`
 * renders, so publishing it is nothing more than flipping a status. The other three screens
 * write documents that other screens also own a piece of — `settings.site` belongs to
 * System → Settings, `seo_settings.identity` to the SEO screen, `settings.copy` is read by
 * the whole public site — so their live rows stayed exactly where they were and
 * `appearance_settings` holds the *draft* and the *history* beside them.
 *
 * That is the conservative half of this feature and it is deliberate: with no version rows
 * at all, every one of these reads returns precisely what it returned before any of this
 * existed, so an unconfigured site is untouched. Publishing writes the same rows the old
 * "save" wrote, through the same validation. What is new is that a save no longer *has* to
 * be a publish.
 *
 * ## Totality
 *
 * `parse` never throws. A hand-edited row, a document written by an older deploy, a version
 * restored from before a field existed — all of them resolve to a complete document with the
 * shipped defaults filled in, because the alternative is a 500 inside a layout.
 */

// ---------------------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------------------

/**
 * Appearance → Brand. The name and tagline live in `settings.site`, the mark and the uploads
 * in `settings.brand`; a *version* carries both, because "the brand as it was on Tuesday" is
 * one thing to an operator and restoring half of it would be a trap.
 */
export const brandDocumentSchema = brandSettingSchema.extend({
  name: z.string().trim().min(1).max(60),
  tagline: z.string().trim().max(200),
})
export type BrandDocument = z.infer<typeof brandDocumentSchema>

export type MenusDocument = MenusSetting

/** Appearance → Copy: the overrides and the formatting document, saved together as they are. */
export interface CopyDocument {
  copy: CopyOverrides
  formatting: FormattingSettings
}

export type ThemeDocument = AppearanceDoc

export interface ScopeDocuments {
  theme: ThemeDocument
  brand: BrandDocument
  menus: MenusDocument
  copy: CopyDocument
}
export type ScopeDocument<S extends AppearanceScope = AppearanceScope> = ScopeDocuments[S]

// ---------------------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------------------

export interface ScopeAdapter<S extends AppearanceScope> {
  readonly scope: S
  /** Total: any input becomes a complete document. */
  parse(raw: unknown): ScopeDocuments[S]
  /** What the site is rendering right now, read uncached. */
  live(db: Db): Promise<ScopeDocuments[S]>
  /**
   * Make a document live. The theme's is a no-op — its published row is the live document,
   * so there is nothing to copy anywhere.
   */
  apply(db: Db, doc: ScopeDocuments[S], userId: number): Promise<void>
  /** The `resolved_css` column. Only the theme derives anything; the rest store ''. */
  derivedCss(doc: ScopeDocuments[S]): string
  /** The handful of fields worth naming in an `audit_log` row. */
  summary(doc: ScopeDocuments[S]): Record<string, unknown>
}

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

const text = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v.trim() !== '' ? v : fallback

const themeAdapter: ScopeAdapter<'theme'> = {
  scope: 'theme',
  parse: parseAppearance,
  live: async (db) => {
    const row = await publishedAppearance(db)
    return row ? parseAppearance(row.settings) : DEFAULT_APPEARANCE
  },
  apply: async () => {
    // The published `appearance_settings` row is itself what `lib/appearance/AppearanceStyle`
    // renders (docs/15 step 2). Publishing is the status change; there is nowhere else to put it.
  },
  derivedCss: (doc) => resolveAppearance(doc).css,
  summary: (doc) => ({ accent: doc.color.accent, theme: doc.theme.default }),
}

const brandAdapter: ScopeAdapter<'brand'> = {
  scope: 'brand',
  parse: (raw) => {
    const r = record(raw)
    const brand = brandSettingSchema.safeParse(r)
    return {
      ...(brand.success ? brand.data : DEFAULT_BRAND_SETTING),
      name: text(r.name, DEFAULT_CHROME.brand.name).slice(0, 60),
      tagline: (typeof r.tagline === 'string' ? r.tagline : DEFAULT_CHROME.brand.tagline).slice(
        0,
        200,
      ),
    }
  },
  live: async (db) => {
    const [site, brand] = await Promise.all([
      getSetting<unknown>(db, 'site', {}),
      getSetting<unknown>(db, 'brand', {}),
    ])
    const s = record(site)
    return brandAdapter.parse({ ...record(brand), name: s.name, tagline: s.tagline })
  },
  apply: async (db, doc, userId) => {
    const [site, seo] = await Promise.all([
      getSetting<Record<string, unknown>>(db, 'site', {}),
      loadSeoSettings(db),
    ])
    const { name, tagline, ...brand } = doc
    // `settings.site` is System → Settings' row as well; only the two fields this screen
    // owns are replaced, so a publish here cannot drop the maintenance flag or the socials.
    await putSetting(db, 'site', { ...site, name, tagline }, userId)
    await putSetting(db, 'brand', brand, userId)
    // Keeping the SEO site name in step is what an operator means by "rename the site" —
    // the same rule the pre-version save had.
    await saveSeoSetting(db, 'identity', { ...seo.identity, site_name: name }, userId)
  },
  derivedCss: () => '',
  summary: (doc) => ({
    name: doc.name,
    tagline: doc.tagline,
    wordmark: doc.wordmark,
    logo_preset: doc.logo_preset,
    logo_dark: doc.logo_dark?.key ?? null,
    logo_light: doc.logo_light?.key ?? null,
    monogram: doc.monogram?.key ?? null,
    social_image: doc.social_image?.key ?? null,
  }),
}

const menusAdapter: ScopeAdapter<'menus'> = {
  scope: 'menus',
  parse: (raw) => {
    const parsed = menusSettingSchema.safeParse(raw)
    if (parsed.success) return parsed.data
    // The screen's own rule: an unparseable (or never-written) row opens on the links the
    // site is actually showing, so the first save cannot wipe the footer.
    return menusFromChrome(
      resolveChrome({ site: null, brand: null, menus: raw, assetUrl: storageUrl }),
      raw,
    )
  },
  live: async (db) => {
    const [site, brand, menus] = await Promise.all([
      getSetting<unknown>(db, 'site', null),
      getSetting<unknown>(db, 'brand', null),
      getSetting<unknown>(db, 'menus', null),
    ])
    const parsed = menusSettingSchema.safeParse(menus)
    if (parsed.success) return parsed.data
    return menusFromChrome(resolveChrome({ site, brand, menus, assetUrl: storageUrl }), menus)
  },
  apply: async (db, doc, userId) => {
    await putSetting(db, 'menus', doc, userId)
  },
  derivedCss: () => '',
  summary: (doc) => ({
    header: doc.header.length,
    footer: doc.footer.length,
    bottom_nav: doc.bottom_nav,
    announcement: doc.announcement.enabled,
  }),
}

const copyAdapter: ScopeAdapter<'copy'> = {
  scope: 'copy',
  parse: (raw) => {
    const r = record(raw)
    return {
      copy: normalizeCopyOverrides(r.copy),
      formatting: parseFormatting(r.formatting),
    }
  },
  live: async (db) => {
    const [copy, formatting] = await Promise.all([
      getSetting<unknown>(db, COPY_SETTING_KEY, null),
      getSetting<unknown>(db, FORMATTING_SETTING_KEY, null),
    ])
    return { copy: normalizeCopyOverrides(copy), formatting: parseFormatting(formatting) }
  },
  apply: async (db, doc, userId) => {
    await putSetting(db, COPY_SETTING_KEY, doc.copy, userId)
    await putSetting(db, FORMATTING_SETTING_KEY, doc.formatting, userId)
  },
  derivedCss: () => '',
  summary: (doc) => ({ overrides: Object.keys(doc.copy).length, ...doc.formatting }),
}

const ADAPTERS = {
  theme: themeAdapter,
  brand: brandAdapter,
  menus: menusAdapter,
  copy: copyAdapter,
} satisfies { [S in AppearanceScope]: ScopeAdapter<S> }

export const scopeAdapter = <S extends AppearanceScope>(scope: S): ScopeAdapter<S> =>
  ADAPTERS[scope] as ScopeAdapter<S>

// ---------------------------------------------------------------------------------------
// Brand uploads: what "restore" means for a setting that points at a file
// ---------------------------------------------------------------------------------------

export interface MissingAsset {
  slot: BrandSlot
  key: string
}

/**
 * Which of a brand document's four uploads are no longer in storage.
 *
 * This is the honest half of "restore". A brand version records object *keys*, not bytes, so
 * a version whose logo has since been removed from the bucket would restore into a broken
 * `<img>` — a site with a hole where the mark was, and nothing to say why.
 *
 * Two things keep the list nearly always empty, and they are worth stating because they are
 * the reason a check at restore time is enough rather than a copy-on-write of every upload:
 *
 * - **Replacing a logo never overwrites one.** The confirm step mints a content-addressed
 *   key (`brand/logo_dark-<sha>.png`), so a new upload is a new object and every older
 *   version still points at a file that exists.
 * - **Clearing a slot no longer deletes the object** unless no stored version references it
 *   (see the DELETE handler in `app/api/admin/appearance/brand/asset`). Unlinking a mark from
 *   the live site is not a reason to make five months of history unrestorable.
 *
 * What is left is the genuinely out-of-band case: someone emptied the bucket, a lifecycle
 * rule expired an object, a restore from a backup taken before the upload. Those are real,
 * and the publish route refuses rather than shipping a broken header — the operator is told
 * which slots are gone and can restore the rest deliberately.
 */
export const missingBrandAssets = async (doc: BrandDocument): Promise<MissingAsset[]> => {
  const referenced = BRAND_SLOTS.map((slot) => ({ slot, key: doc[slot]?.key })).filter(
    (r): r is MissingAsset => typeof r.key === 'string' && r.key !== '',
  )
  if (referenced.length === 0) return []
  const storage = await getStorage()
  const checks = await Promise.all(
    // A storage error counts as "present". The failure this guards against is a *known*
    // missing object; a bucket that is briefly unreachable must not be able to block a
    // publish, which is the worse of the two ways to be wrong here.
    referenced.map(async (r) => ((await storage.exists(r.key).catch(() => true)) ? null : r)),
  )
  return checks.filter((r): r is MissingAsset => r !== null)
}

/** The same document with the named slots cleared — "restore it without the missing images". */
export const withoutAssets = (
  doc: BrandDocument,
  missing: readonly MissingAsset[],
): BrandDocument => {
  const next = { ...doc }
  for (const { slot } of missing) next[slot] = null
  return next
}
