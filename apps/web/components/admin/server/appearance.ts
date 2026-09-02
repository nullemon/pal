import { appearanceSettings, getDb, getSetting, themePresets, users } from '@palscans/db'
import { desc, eq, inArray } from 'drizzle-orm'
import { readerAdsSchema, readerLayoutSchema } from '@/components/reader/server/settings'
import { parseAppearance } from '@/lib/appearance/schema'
import { BUILT_LAYOUTS, DIRECTIONS, type LayoutsSetting } from '../schemas-appearance'

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

export const loadThemeScreen = async () => {
  const db = await getDb()
  const rows = await db
    .select({
      id: appearanceSettings.id,
      settings: appearanceSettings.settings,
      status: appearanceSettings.status,
      publishedAt: appearanceSettings.publishedAt,
      createdAt: appearanceSettings.createdAt,
      createdBy: users.username,
    })
    .from(appearanceSettings)
    .leftJoin(users, eq(users.id, appearanceSettings.createdBy))
    .where(inArray(appearanceSettings.status, ['draft', 'published', 'archived']))
    .orderBy(desc(appearanceSettings.id))
    .limit(30)
  const published = rows.find((r) => r.status === 'published') ?? null
  const draft = rows.find((r) => r.status === 'draft') ?? null
  const presets = await db
    .select({
      id: themePresets.id,
      name: themePresets.name,
      settings: themePresets.settings,
      isBuiltin: themePresets.isBuiltin,
    })
    .from(themePresets)
    .orderBy(desc(themePresets.isBuiltin), themePresets.name)
  return {
    draft: draft ? { id: draft.id, doc: parseAppearance(draft.settings) } : null,
    published: published
      ? {
          id: published.id,
          doc: parseAppearance(published.settings),
          publishedAt: published.publishedAt?.toISOString() ?? null,
          by: published.createdBy,
        }
      : null,
    versions: rows.map((r) => ({
      id: r.id,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      publishedAt: r.publishedAt?.toISOString() ?? null,
      by: r.createdBy,
    })),
    presets: presets.map((p) => ({
      id: p.id,
      name: p.name,
      isBuiltin: p.isBuiltin,
      doc: parseAppearance(p.settings),
    })),
  }
}
