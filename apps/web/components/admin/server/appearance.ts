import { getDb, getSetting, publishedAppearance, themePresets } from '@palscans/db'
import { desc } from 'drizzle-orm'
import { readerAdsSchema, readerLayoutSchema } from '@/components/reader/server/settings'
import { type AdvancedDoc, EMPTY_ADVANCED, parseAppearance } from '@/lib/appearance/schema'
import type { AppearanceScope } from '@/lib/appearance/scope'
import { loadScopeState, type ScopeState } from '@/lib/appearance/versions'
import type { AppearanceWorkflowState } from '../client/AppearanceWorkflow'
import { BUILT_LAYOUTS, DIRECTIONS, type LayoutsSetting } from '../schemas-appearance'

/**
 * The scope state, minus the documents, in the shape the shared workflow control takes.
 *
 * Deliberately drops `live` and the draft/published documents: a screen seeds its form from
 * one of them and the workflow needs none, and shipping every document twice is how an
 * admin page's payload doubles without anyone noticing.
 */
export const workflowState = (state: ScopeState<AppearanceScope>): AppearanceWorkflowState => ({
  hasDraft: state.draft !== null,
  draftSavedAt: state.draft?.savedAt ?? null,
  draftBy: state.draft?.by ?? null,
  publishedAt: state.published?.publishedAt ?? null,
  publishedBy: state.published?.by ?? null,
  versions: state.versions,
})

export const loadLayoutsSetting = async (): Promise<LayoutsSetting> => {
  const db = await getDb()
  const [layouts, ads] = await Promise.all([
    getSetting<{ home?: unknown; series?: unknown; reader?: unknown }>(db, 'layouts', {}),
    getSetting<{ reader?: unknown }>(db, 'ads', {}),
  ])
  const dir = (v: unknown, fallback: LayoutsSetting['home']) =>
    typeof v === 'string' && (DIRECTIONS as readonly string[]).includes(v)
      ? (v as LayoutsSetting['home'])
      : fallback
  const reader = readerLayoutSchema.parse(layouts.reader ?? {})
  const readerAds = readerAdsSchema.parse(ads.reader ?? {})
  return {
    home: dir(layouts.home, BUILT_LAYOUTS.home[0] ?? 'A'),
    series: dir(layouts.series, BUILT_LAYOUTS.series[0] ?? 'B'),
    reader: { default_mode: reader.default_mode },
    ads: readerAds,
  }
}

/**
 * Appearance → Theme: the same scope state every other Appearance screen loads
 * (`lib/appearance/versions.ts`), plus the presets, which only this screen has.
 */
export const loadThemeScreen = async () => {
  const db = await getDb()
  const [state, presets] = await Promise.all([
    loadScopeState('theme', db),
    db
      .select({
        id: themePresets.id,
        name: themePresets.name,
        settings: themePresets.settings,
        isBuiltin: themePresets.isBuiltin,
      })
      .from(themePresets)
      .orderBy(desc(themePresets.isBuiltin), themePresets.name),
  ])
  return {
    ...state,
    presets: presets.map((p) => ({
      id: p.id,
      name: p.name,
      isBuiltin: p.isBuiltin,
      doc: parseAppearance(p.settings),
    })),
  }
}

/**
 * Appearance → Advanced (docs/15). The *published* block, read straight from the row rather
 * than through the 300s `appearance` cache: this screen is where an operator has just saved,
 * and a page that shows them the previous stylesheet reads as a lost save.
 */
export const loadAdvanced = async (): Promise<AdvancedDoc> => {
  const row = await publishedAppearance(await getDb())
  return row ? parseAppearance(row.settings).advanced : EMPTY_ADVANCED
}
