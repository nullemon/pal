import { normalizeWatermark, WATERMARK_SETTING_KEY } from '@palscans/core/watermark'
import { getDb, getSetting } from '@palscans/db'
import { WatermarkScreen } from '@/components/admin/client/WatermarkScreen'
import { withPermission } from '@/lib/auth'
import { watermarkFontAvailable } from '@/lib/watermark'

/**
 * Appearance → Watermark (docs/03 "Worker: chapter.process"). The stored row is normalised
 * before it reaches the form, so a hand-edited or older `settings.watermark` opens with
 * sane values instead of a broken control.
 */
export default async function WatermarkPage() {
  await withPermission('settings.write', { returnTo: '/admin/appearance/watermark' })
  const [raw, fontAvailable] = await Promise.all([
    getSetting<unknown>(await getDb(), WATERMARK_SETTING_KEY, null),
    watermarkFontAvailable(),
  ])
  return <WatermarkScreen initial={normalizeWatermark(raw)} fontAvailable={fontAvailable} />
}
