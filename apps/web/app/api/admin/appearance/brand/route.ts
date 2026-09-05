import { getDb, getSetting, settings } from '@palscans/db'
import { revalidateTag } from 'next/cache'
import { brandFormSchema } from '@/components/admin/schemas-appearance'
import { audit } from '@/components/admin/server/audit'
import { purgeSettings } from '@/components/admin/server/cache'
import { ok, parseJson, withPermission } from '@/lib/auth'
import { brandSettingSchema } from '@/lib/chrome/schema'
import { loadSeoSettings, saveSeoSetting } from '@/lib/seo/settings'

/**
 * `PUT /api/admin/appearance/brand` — Appearance → Brand (docs/15 "Brand and identity"),
 * minus the uploads, which have their own route under `./asset`.
 *
 * The site name and tagline are written back to **`settings.site`**, the row the System →
 * Settings screen has always owned, rather than to a second copy: before this the header
 * ignored that row entirely, and the fix is to make one row authoritative, not to add a rival.
 * The uploads and the wordmark style go to `settings.brand`, merged so an upload made in
 * another tab is not wiped by a save here.
 *
 * The name is also pushed into `seo_settings.identity.site_name`, which is what builds
 * `<title>` and the OpenGraph site name. Keeping them in step is what an operator means by
 * "rename the site"; the SEO screen can still set a different name afterwards for search
 * results, and the next brand rename will overwrite it again.
 */
export const PUT = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, brandFormSchema)
  if (!parsed.ok) return parsed.response
  const { name, tagline, wordmark, logo_preset, monogram_bg } = parsed.data
  const db = await getDb()
  const now = new Date()

  const [beforeSite, beforeBrand, seo] = await Promise.all([
    getSetting<Record<string, unknown>>(db, 'site', {}),
    getSetting<Record<string, unknown>>(db, 'brand', {}),
    loadSeoSettings(db),
  ])

  const site = { ...beforeSite, name, tagline }
  // The uploads are carried through untouched: a preset and an upload are two sources for
  // one setting, and switching to a preset must not throw the operator's own file away.
  const brand = {
    ...brandSettingSchema.parse(beforeBrand ?? {}),
    wordmark,
    logo_preset,
    monogram_bg,
  }

  for (const [key, value] of [
    ['site', site],
    ['brand', brand],
  ] as const) {
    await db
      .insert(settings)
      .values({ key, value, updatedBy: user.id, updatedAt: now })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedBy: user.id, updatedAt: now },
      })
  }
  await saveSeoSetting(db, 'identity', { ...seo.identity, site_name: name }, user.id)

  purgeSettings()
  revalidateTag('seo', 'max')
  await audit({
    actorId: user.id,
    action: 'settings.brand',
    targetType: 'settings',
    before: {
      name: beforeSite.name ?? null,
      tagline: beforeSite.tagline ?? null,
      wordmark: (beforeBrand as { wordmark?: unknown }).wordmark ?? null,
      logo_preset: (beforeBrand as { logo_preset?: unknown }).logo_preset ?? null,
      seo_site_name: seo.identity.site_name,
    },
    after: { name, tagline, wordmark, logo_preset, monogram_bg, seo_site_name: name },
    request,
  })
  return ok({ name, tagline, wordmark, logo_preset, monogram_bg })
})
