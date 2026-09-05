import 'server-only'

import {
  COPY_SETTING_KEY,
  type CopyFn,
  type CopyMap,
  type CopyOverrides,
  copyFn,
  DEFAULT_COPY,
  normalizeCopyOverrides,
  resolveCopy,
} from '@palscans/core/copy'
import {
  DEFAULT_FORMATTING,
  FORMATTING_SETTING_KEY,
  type FormattingSettings,
  parseFormatting,
} from '@palscans/core/formatting'
import type { Db } from '@palscans/db'
import { getDb, getSetting, settings } from '@palscans/db'
import { unstable_cache } from 'next/cache'
import { cache } from 'react'

/**
 * Appearance → Copy and Appearance → Formatting (docs/15), read the way `ads`, `layouts`
 * and `entitlements` are: two rows in the generic `settings` table, no migration.
 *
 * `server-only` at the top is load-bearing. The registry, the resolver and this module have
 * no business in a reader's bundle, and the import would be easy to add by accident from a
 * client component that wanted one string — which is precisely how zod and the admin
 * catalogue ended up on every reader's phone (docs/20 "What was in there"). Client
 * components get the resolved strings from `lib/copy/context`, which imports nothing.
 *
 * The read is cached for 60s and tagged `settings`, so the admin save's `purgeSettings()`
 * takes effect immediately, and `cache()` memoises it per request. A database blip falls
 * back to the shipped catalogue rather than throwing: a page that cannot reach Postgres
 * should still render the copy it was compiled with.
 *
 * NOTE — there is a *second*, dead formatting document in the database. The seed writes
 * `settings.site.formatting` (`{relative_times, clock, compact_numbers, chapter_label,
 * week_starts}`, snake_case, `compact_numbers` a boolean) and nothing has ever read it:
 * grep the repo and the only hits are the seed itself. `settings.formatting` — this row — is
 * the live one, kept separate from `settings.site` for the same reason `ads`, `layouts` and
 * `comments` are separate: `settings.site` belongs to Admin → System → Settings, and two
 * screens writing one row is how a save silently drops the other screen's fields. The dead
 * block in the seed is left alone rather than quietly deleted; it is worth a decision, not a
 * drive-by.
 */

export { COPY_SETTING_KEY, FORMATTING_SETTING_KEY }

export interface SiteCopySettings {
  /** Every editable string, override applied over the shipped default. */
  copy: CopyMap
  /** Only what actually differs — this is what crosses to the client. Usually `{}`. */
  overrides: CopyOverrides
  formatting: FormattingSettings
}

export const DEFAULT_SITE_COPY: SiteCopySettings = Object.freeze({
  copy: DEFAULT_COPY,
  overrides: Object.freeze({}),
  formatting: DEFAULT_FORMATTING,
})

/** Uncached: the admin screens and the save route, which must see their own write. */
export const loadSiteCopy = async (db?: Db): Promise<SiteCopySettings> => {
  const database = db ?? (await getDb())
  const [rawCopy, rawFormatting] = await Promise.all([
    getSetting<unknown>(database, COPY_SETTING_KEY, null),
    getSetting<unknown>(database, FORMATTING_SETTING_KEY, null),
  ])
  const overrides = normalizeCopyOverrides(rawCopy)
  return {
    copy: resolveCopy(overrides),
    overrides,
    formatting: parseFormatting(rawFormatting),
  }
}

const cachedSiteCopy = unstable_cache(
  async (): Promise<SiteCopySettings> => {
    try {
      return await loadSiteCopy()
    } catch {
      return DEFAULT_SITE_COPY
    }
  },
  ['settings', COPY_SETTING_KEY],
  { revalidate: 60, tags: ['settings'] },
)

/**
 * The copy and formatting for this request. Never throws, never blocks a render.
 *
 * A staff preview (docs/15) swaps the draft in for one viewer. The check is free for
 * everyone else and for every prerender — see `lib/appearance/preview.ts` for why reading
 * Next's draft-mode flag does not make a route dynamic — so the cached read below is still
 * what serves every reader.
 */
export const siteCopySettings = cache(async (): Promise<SiteCopySettings> => {
  try {
    const { previewScopes } = await import('@/lib/appearance/preview')
    if ((await previewScopes()).includes('copy')) {
      const { draftDocument } = await import('@/lib/appearance/versions')
      const draft = await draftDocument('copy')
      if (draft)
        return {
          copy: resolveCopy(draft.copy),
          overrides: draft.copy,
          formatting: draft.formatting,
        }
    }
  } catch {
    // A preview that cannot be resolved is not a preview; fall through to what is published.
  }
  try {
    return await cachedSiteCopy()
  } catch {
    // No request scope (a unit test, the worker) or an unreachable cache: the catalogue.
    return DEFAULT_SITE_COPY
  }
})

/**
 * `const copy = await siteCopy()` then `copy('browse.empty')` — the common case for a
 * server component, and the server-side twin of `useCopy()` in `./context`.
 */
export const siteCopy = async (): Promise<CopyFn> => copyFn((await siteCopySettings()).copy)

/** Just the formatting document. */
export const siteFormatting = async (): Promise<FormattingSettings> =>
  (await siteCopySettings()).formatting

/** Both, for a component that needs a string *and* a number format. One await, one cache hit. */
export const siteAppearance = async (): Promise<{
  copy: CopyFn
  formatting: FormattingSettings
}> => {
  const s = await siteCopySettings()
  return { copy: copyFn(s.copy), formatting: s.formatting }
}

/** Upsert one of the two rows. The caller writes the `audit_log` entry. */
export const saveCopySetting = async (
  db: Db,
  key: typeof COPY_SETTING_KEY | typeof FORMATTING_SETTING_KEY,
  value: CopyOverrides | FormattingSettings,
  updatedBy: number,
): Promise<void> => {
  const now = new Date()
  await db
    .insert(settings)
    .values({ key, value, updatedBy, updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy, updatedAt: now } })
}
