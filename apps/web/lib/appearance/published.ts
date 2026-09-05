import { getDb, publishedAppearance } from '@palscans/db'
import { unstable_cache } from 'next/cache'
import { type AdvancedDoc, advancedSchema, EMPTY_ADVANCED } from './schema'

/**
 * One read of the published appearance row, shared by everything that needs a piece of it.
 *
 * docs/15 step 2: the token block is inlined in `<head>` so there is no extra request and no
 * flash of the old theme. The operator's custom code (docs/15 "Advanced") comes out of the
 * same row and the same cache entry, so adding it costs no second query — but it is
 * deliberately *not* returned as part of the `<head>` block, because that block renders on
 * every route including `/admin`. See `components/shell/CustomCode.tsx`.
 *
 * Cached under the `appearance` tag; publishing calls `revalidateTag('appearance')`. Empty
 * when the database is unreachable, so the shell still renders with the compiled defaults.
 */
export type ThemeDefault = 'dark' | 'light' | 'system'

export interface PublishedAppearance {
  css: string
  themeDefault: ThemeDefault
  advanced: AdvancedDoc
}

export const themeDefaultOf = (settings: unknown): ThemeDefault => {
  const v = (settings as { theme?: { default?: unknown } } | null)?.theme?.default
  return v === 'light' || v === 'system' ? v : 'dark'
}

/**
 * Parsed rather than trusted. This row is JSON in Postgres: a restored backup, a hand-edited
 * document or a rolled-back deploy can put anything in it, and a `css` field that arrives as
 * a number or an object must not reach `dangerouslySetInnerHTML`.
 */
const advancedOf = (settings: unknown): AdvancedDoc => {
  const raw = (settings as { advanced?: unknown } | null)?.advanced
  const parsed = advancedSchema.safeParse(raw ?? {})
  return parsed.success ? parsed.data : EMPTY_ADVANCED
}

export const cachedAppearance = unstable_cache(
  async (): Promise<PublishedAppearance> => {
    try {
      const row = await publishedAppearance(await getDb())
      return {
        css: row?.resolvedCss ?? '',
        themeDefault: themeDefaultOf(row?.settings),
        advanced: advancedOf(row?.settings),
      }
    } catch {
      return { css: '', themeDefault: 'dark', advanced: EMPTY_ADVANCED }
    }
  },
  ['appearance', 'published'],
  { revalidate: 300, tags: ['appearance'] },
)

export const cachedAppearanceCss = async (): Promise<string> => (await cachedAppearance()).css

/**
 * The custom code as it should be rendered: the master switch applied here rather than at
 * each call site, so "off" cannot be forgotten by one of the three slots.
 */
export const cachedCustomCode = async (): Promise<AdvancedDoc> => {
  const { advanced } = await cachedAppearance()
  return advanced.enabled ? advanced : EMPTY_ADVANCED
}
