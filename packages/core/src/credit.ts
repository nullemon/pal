import { z } from 'zod'

/**
 * The credit page (docs/03): a card inserted as the second page of every chapter, naming the
 * people who worked on it.
 *
 * Crediting is the convention scanlations are shared under, and a credit page is how a group
 * actually does it — not a line in the metadata, a page the reader sees. The site had the
 * group *name* on the series page and nowhere to put the people.
 *
 * It is composed, not uploaded: a background chosen per series, one of a few transparent
 * overlays on top, and the text rendered in. That way changing a handle is one edit here
 * rather than re-exporting and re-uploading an image for every series.
 *
 * Everything in this module is pure — the shapes, their defaults and the resolution rules —
 * so the admin screen, the renderer and the page inserter cannot disagree about what a
 * credit page says.
 */

/** One line of the credit table: a role and the person who did it. */
export const creditRoleSchema = z.object({
  /** Shown on the left, e.g. `TYPESETTER`. Free text — groups name roles differently. */
  label: z.string().trim().min(1).max(40),
  /** Shown on the right, e.g. `NaPal__`. Blank hides the row rather than printing an empty box. */
  handle: z.string().trim().max(60).default(''),
})
export type CreditRole = z.infer<typeof creditRoleSchema>

/** One uploaded overlay: the transparent frame the text is drawn into. */
export const creditOverlaySchema = z.object({
  id: z.string().trim().min(1).max(40),
  /** What it is called in the picker, e.g. `Ink`, `Cosy`, `Neon`. */
  name: z.string().trim().min(1).max(60),
  /** Storage key of the transparent PNG. */
  key: z.string().trim().min(1).max(300),
})
export type CreditOverlay = z.infer<typeof creditOverlaySchema>

export const creditSettingsSchema = z.object({
  /**
   * Off by default, and the renderer refuses while it is off.
   *
   * The feature inserts a page into every new chapter. That is not something to discover by
   * accident because a half-filled settings row existed, so it stays inert until an operator
   * has uploaded an overlay and turned it on deliberately.
   */
  enabled: z.boolean().default(false),
  overlays: z.array(creditOverlaySchema).max(12).default([]),
  /** Which overlay a series uses when it has not chosen one. */
  defaultOverlayId: z.string().trim().max(40).default(''),
  /** A background for series that have none, so the page is never bare. */
  defaultBackgroundKey: z.string().trim().max(300).default(''),
  roles: z.array(creditRoleSchema).max(12).default([]),
  /** The note shown when a chapter has not been given its own. */
  defaultNote: z.string().trim().max(600).default(''),
  /** The two footer values. Rendered as text, not as links — it is an image. */
  discord: z.string().trim().max(120).default(''),
  twitter: z.string().trim().max(120).default(''),
})
export type CreditSettings = z.infer<typeof creditSettingsSchema>

export const DEFAULT_CREDIT_SETTINGS: CreditSettings = creditSettingsSchema.parse({})

/**
 * Everything one chapter's credit page shows, after the per-series and per-chapter overrides
 * have been applied to the site settings.
 */
export interface ResolvedCredit {
  overlayKey: string | null
  backgroundKey: string | null
  roles: CreditRole[]
  note: string
  discord: string
  twitter: string
}

export interface CreditSources {
  settings: CreditSettings
  /** `series.credit_background_key` / `credit_overlay_id`. */
  series?: { backgroundKey?: string | null; overlayId?: string | null } | null
  /** `chapters.credit_note` — the per-chapter override. */
  chapterNote?: string | null
}

/**
 * Resolve what this chapter's credit page says.
 *
 * The precedence is the whole feature in one function: chapter note beats the default note,
 * series background beats the default background, series overlay beats the default overlay.
 * A blank override is not an override — an operator clearing a field means "use the default
 * again", which is what they expect from an empty box, and is why `.trim()` matters here.
 *
 * Returns null when there is nothing to draw on. A credit page with no overlay would be the
 * background with text floating over it, which looks like a bug rather than a decision.
 */
export const resolveCredit = ({
  settings,
  series,
  chapterNote,
}: CreditSources): ResolvedCredit | null => {
  if (!settings.enabled) return null
  const overlayId = series?.overlayId?.trim() || settings.defaultOverlayId.trim()
  const overlay = settings.overlays.find((o) => o.id === overlayId) ?? null
  if (!overlay) return null
  const note = chapterNote?.trim() || settings.defaultNote
  return {
    overlayKey: overlay.key,
    backgroundKey: series?.backgroundKey?.trim() || settings.defaultBackgroundKey.trim() || null,
    // A role with no handle is a row the group has not filled in; printing an empty box is
    // worse than printing nothing.
    roles: settings.roles.filter((r) => r.handle.trim() !== ''),
    note,
    discord: settings.discord,
    twitter: settings.twitter,
  }
}

/**
 * Where the credit page sits in a chapter: index 1, the second page.
 *
 * Second rather than first because the first page is the cover, which is what a reader sees
 * in every thumbnail and every share. Burying the cover behind a credit card would change
 * what the chapter looks like everywhere it is linked.
 */
export const CREDIT_PAGE_INDEX = 1

/**
 * Where the credit page lands in a chapter of `pageCount` pages.
 *
 * A one-page chapter puts it last rather than in the middle of nothing, and a chapter with no
 * pages gets none at all — there is nothing for it to be the second page of.
 */
export const creditPageIndex = (pageCount: number): number | null => {
  if (pageCount <= 0) return null
  return Math.min(CREDIT_PAGE_INDEX, pageCount)
}
