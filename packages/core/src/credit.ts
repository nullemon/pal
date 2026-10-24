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

/**
 * The face the card's text is drawn in.
 *
 * A fixed list rather than an upload: the font has to exist in the image fontconfig reads,
 * and librsvg fails *silently* on a missing face — it draws an empty layer, so a card with an
 * unavailable font would come out as artwork with no names on it. Shipping the faces with the
 * image and naming them here is what keeps that from being possible.
 */
export const creditFontSchema = z.enum(['anime-ace', 'vampire-wars', 'plain'])
export type CreditFont = z.infer<typeof creditFontSchema>

/** Comic lettering, which is what a credit page is set in. */
export const DEFAULT_CREDIT_FONT: CreditFont = 'anime-ace'

/**
 * The rows a fresh install starts with, and who is in them.
 *
 * Both halves are prefilled on purpose. The labels, because they are no longer the
 * artwork's: the renderer paints over the names printed on the card and draws these
 * instead, so the supplied artwork naming CLEANER and REDRAWER twice and having no row for
 * quality check stopped being a constraint. The handles, because this is one group's site
 * and typing its own team in on first run is a chore with one correct answer.
 *
 * Every one of them is editable, and a row with no handle beside it is left off the card.
 */
export const DEFAULT_CREDIT_ROLES: ReadonlyArray<{ label: string; handle: string }> = [
  { label: 'TRANSLATOR', handle: 'JaPal__' },
  { label: 'CLEANER', handle: 'HaPal__' },
  { label: 'REDRAWER', handle: 'NaPal__' },
  { label: 'TYPESETTER', handle: 'PaPal__' },
  { label: 'PROOFREADER', handle: 'DaPal__' },
  { label: 'QUALITY CHECK', handle: 'LaPal__' },
]

/**
 * Cards that ship with the site, so the feature works the moment it is switched on.
 *
 * Overlays are uploads, and for a while they were *only* uploads — a new design should not
 * need a deploy. The cost of that showed up immediately: a fresh install has no card, so
 * turning the feature on inserts nothing into anything and says nothing about why. One
 * shipped card is the difference between a switch that works and a switch that looks broken.
 *
 * A `builtin:` key is read from the application's own files rather than from storage (see
 * `apps/web/lib/credit/render.ts`), which is what lets it exist before anyone has uploaded
 * anything. An operator can still upload their own and pick it instead.
 */
export const BUILTIN_CREDIT_OVERLAY_PREFIX = 'builtin:'

export const BUILTIN_CREDIT_OVERLAYS: ReadonlyArray<CreditOverlay> = [
  { id: 'sakura-ink', name: 'Sakura Ink (built in)', key: 'builtin:sakura-ink' },
]

export const isBuiltinOverlay = (key: string): boolean =>
  key.startsWith(BUILTIN_CREDIT_OVERLAY_PREFIX)

export const creditSettingsSchema = z.object({
  /**
   * Off by default, and the renderer refuses while it is off.
   *
   * The feature inserts a page into every new chapter. That is not something to discover by
   * accident because a half-filled settings row existed, so it stays inert until an operator
   * has uploaded an overlay and turned it on deliberately.
   */
  enabled: z.boolean().default(false),
  /**
   * When the feature was switched on, ISO. Chapters created before it do not get a card.
   *
   * The operator's choice, and it needs a line in the data rather than a rule in the head:
   * turning this on should not silently insert a page into a thousand chapters that readers
   * have already read, bookmarked and linked to. Stamped by the save, cleared when the
   * feature is turned off, so switching it on again starts a fresh line rather than
   * retroactively claiming everything since the first time. `allChapters` overrides it for
   * an operator who does want the whole archive credited.
   */
  enabledAt: z.string().trim().max(40).default(''),
  /**
   * Put a card into everything already published, not just what is uploaded from now on.
   *
   * Off by default, and it is a separate switch rather than simply clearing `enabledAt`
   * because it is a separate decision with a visible cost: every existing chapter gains a
   * page, so page counts change under readers who have already read, bookmarked and linked
   * to them. Turning it back off restores the cutoff rather than losing it, since nothing
   * was written to the chapters themselves — the card is composed at read time.
   */
  allChapters: z.boolean().default(false),
  /**
   * The shipped card is in the default, so an operator who switches the feature on and
   * fills in the names gets a credit page without uploading anything.
   */
  overlays: z
    .array(creditOverlaySchema)
    .max(12)
    .default([...BUILTIN_CREDIT_OVERLAYS]),
  /** Which overlay a series uses when it has not chosen one. */
  defaultOverlayId: z
    .string()
    .trim()
    .max(40)
    .default(BUILTIN_CREDIT_OVERLAYS[0]?.id ?? ''),
  /** A background for series that have none, so the page is never bare. */
  defaultBackgroundKey: z.string().trim().max(300).default(''),
  roles: z
    .array(creditRoleSchema)
    .max(12)
    .default([...DEFAULT_CREDIT_ROLES]),
  /**
   * `.catch` rather than a plain default: a value stored by a build that offered a face this
   * one no longer has would otherwise fail the whole parse, and a failed parse falls back to
   * settings with the feature *off* — one retired font would silently stop every credit page.
   */
  font: creditFontSchema.catch(DEFAULT_CREDIT_FONT).default(DEFAULT_CREDIT_FONT),
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
  font: CreditFont
  roles: CreditRole[]
  note: string
  discord: string
  twitter: string
}

export interface CreditSources {
  settings: CreditSettings
  /** When this chapter was created. Before `enabledAt` means no card — see that field. */
  chapterCreatedAt?: Date | string | null
  /** `series.credit_background_key` / `credit_overlay_id` / `credit_disabled`. */
  series?: {
    backgroundKey?: string | null
    overlayId?: string | null
    /** This series is another group's work: no credit page on any chapter of it. */
    disabled?: boolean | null
  } | null
  /** `chapters.credit_note` — the per-chapter override. */
  chapterNote?: string | null
  /** `chapters.credit_disabled` — this one chapter came from elsewhere. */
  chapterDisabled?: boolean | null
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
  chapterCreatedAt,
  chapterDisabled,
}: CreditSources): ResolvedCredit | null => {
  if (!settings.enabled) return null
  /**
   * Work that is not ours gets no credit page, whatever the site settings say.
   *
   * Checked before everything else because it is not a preference: a site that hosts
   * another group's chapters printing its own team on them is worse than printing nothing,
   * and no combination of the switches below should be able to override it.
   */
  if (series?.disabled === true || chapterDisabled === true) return null
  /**
   * Chapters that predate the switch keep the pages they were published with.
   *
   * An unknown creation date is treated as *older*, not newer: the failure that matters is
   * inserting a page into an archive nobody asked to change, and a missing timestamp is not
   * evidence that a chapter is new.
   */
  const since =
    !settings.allChapters && settings.enabledAt.trim() ? Date.parse(settings.enabledAt) : Number.NaN
  if (Number.isFinite(since)) {
    const created = chapterCreatedAt
      ? Date.parse(String(new Date(chapterCreatedAt).toISOString()))
      : Number.NaN
    if (!Number.isFinite(created) || created < since) return null
  }
  const overlayId = series?.overlayId?.trim() || settings.defaultOverlayId.trim()
  const overlay = settings.overlays.find((o) => o.id === overlayId) ?? null
  if (!overlay) return null
  const note = chapterNote?.trim() || settings.defaultNote
  return {
    overlayKey: overlay.key,
    backgroundKey: series?.backgroundKey?.trim() || settings.defaultBackgroundKey.trim() || null,
    font: settings.font,
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
