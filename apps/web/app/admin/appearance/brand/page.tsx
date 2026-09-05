import { adminMessages } from '@palscans/core/messages/admin'
import { getDb, getSetting } from '@palscans/db'
import { BrandScreen } from '@/components/admin/client/BrandScreen'
import { BRAND_SLOTS } from '@/components/admin/schemas-appearance'
import { PageHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'
import { iconHref, iconVersion } from '@/lib/chrome/icons'
import { brandSetting } from '@/lib/chrome/load'
import { LOGO_PRESET_ART } from '@/lib/chrome/preset-art'
import { LOGO_PRESETS } from '@/lib/chrome/presets'
import { DEFAULT_CHROME } from '@/lib/site'
import { storageUrl } from '@/lib/storage'

/**
 * Appearance → Brand (docs/15). Read uncached — this screen's job is to show what is stored,
 * and `revalidateTag` leaves one stale render behind a save.
 *
 * The ten logo directions travel to the client as markup rather than as an import, so the
 * catalogue's 13 KB of SVG stays in the server bundle and only the picker's own copy crosses.
 */
export default async function BrandPage() {
  await withPermission('settings.write', { returnTo: '/admin/appearance/brand' })
  const db = await getDb()
  const [site, brand] = await Promise.all([
    getSetting<Record<string, unknown>>(db, 'site', {}),
    brandSetting(),
  ])
  const version = iconVersion(brand)
  const m = adminMessages.brand
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <BrandScreen
        initial={{
          name: typeof site.name === 'string' && site.name ? site.name : DEFAULT_CHROME.brand.name,
          tagline: typeof site.tagline === 'string' ? site.tagline : DEFAULT_CHROME.brand.tagline,
          wordmark: brand.wordmark,
          logo_preset: brand.logo_preset,
          monogram_bg: brand.monogram_bg,
        }}
        presets={LOGO_PRESETS.map((p) => ({ ...p, svg: LOGO_PRESET_ART[p.id] }))}
        assets={Object.fromEntries(
          BRAND_SLOTS.map((slot) => {
            const asset = brand[slot]
            return [slot, asset ? { ...asset, url: storageUrl(asset.key) } : null]
          }),
        )}
        icons={
          version
            ? {
                version,
                sizes: (
                  [
                    'icon-32.png',
                    'icon-192.png',
                    'maskable-192.png',
                    'apple-touch-icon.png',
                  ] as const
                ).map((asset) => ({ asset, href: iconHref(version, asset) })),
                social: iconHref(version, 'social.png'),
              }
            : null
        }
      />
    </>
  )
}
