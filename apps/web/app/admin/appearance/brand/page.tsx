import { adminMessages } from '@palscans/core/messages/admin'
import { BrandScreen } from '@/components/admin/client/BrandScreen'
import { BRAND_SLOTS } from '@/components/admin/schemas-appearance'
import { workflowState } from '@/components/admin/server/appearance'
import { PageHeader } from '@/components/admin/ui'
import { loadScopeState } from '@/lib/appearance/versions'
import { withPermission } from '@/lib/auth'
import { iconHref, iconVersion } from '@/lib/chrome/icons'
import { brandSetting } from '@/lib/chrome/load'
import { LOGO_PRESET_ART } from '@/lib/chrome/preset-art'
import { LOGO_PRESETS } from '@/lib/chrome/presets'
import { storageUrl } from '@/lib/storage'

/**
 * Appearance → Brand (docs/15). Read uncached — this screen's job is to show what is stored,
 * and `revalidateTag` leaves one stale render behind a publish.
 *
 * The form opens on the draft when there is one, otherwise on what is live. The generated
 * icon previews are the exception and are deliberately read from the **published** row: the
 * `/brand/<version>/<asset>` route renders from what is live and 404s any other version, so
 * showing a draft's version here would show four broken images. The screen says so.
 *
 * The eleven logo directions travel to the client as markup rather than as an import, so the
 * catalogue's 13 KB of SVG stays in the server bundle and only the picker's own copy crosses.
 */
export default async function BrandPage() {
  await withPermission('settings.write', { returnTo: '/admin/appearance/brand' })
  const [state, live] = await Promise.all([loadScopeState('brand'), brandSetting()])
  const doc = state.draft?.doc ?? state.live
  const version = iconVersion(live)
  const m = adminMessages.brand
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <BrandScreen
        initial={{
          name: doc.name,
          tagline: doc.tagline,
          wordmark: doc.wordmark,
          logo_preset: doc.logo_preset,
          monogram_bg: doc.monogram_bg,
        }}
        presets={LOGO_PRESETS.map((p) => ({ ...p, svg: LOGO_PRESET_ART[p.id] }))}
        assets={Object.fromEntries(
          BRAND_SLOTS.map((slot) => {
            const asset = doc[slot]
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
        workflow={workflowState(state)}
      />
    </>
  )
}
