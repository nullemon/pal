import { can } from '@palscans/core'
import { normalizeWatermark, WATERMARK_SETTING_KEY } from '@palscans/core/watermark'
import { getDb, getSetting } from '@palscans/db'
import { WatermarkScreen } from '@/components/admin/client/WatermarkScreen'
import {
  currentWatermark,
  readWatermarkRun,
  watermarkCounts,
} from '@/components/admin/server/watermark'
import { withPermission } from '@/lib/auth'
import { watermarkFontAvailable } from '@/lib/watermark'

/**
 * Appearance → Watermark (docs/03 "Worker: chapter.process"). The stored row is normalised
 * before it reaches the form, so a hand-edited or older `settings.watermark` opens with
 * sane values instead of a broken control.
 */
export default async function WatermarkPage() {
  const user = await withPermission('settings.write', {
    returnTo: '/admin/appearance/watermark',
  })
  const { fingerprint } = await currentWatermark()
  const [raw, fontAvailable, run, counts] = await Promise.all([
    getSetting<unknown>(await getDb(), WATERMARK_SETTING_KEY, null),
    watermarkFontAvailable(),
    readWatermarkRun(),
    watermarkCounts(fingerprint),
  ])
  return (
    <WatermarkScreen
      initial={normalizeWatermark(raw)}
      fontAvailable={fontAvailable}
      status={{ run, counts }}
      canReapply={can(user, 'chapter.repair')}
    />
  )
}
