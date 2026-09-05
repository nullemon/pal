import 'server-only'
import { watermarkSvg } from '@palscans/core/watermark'
import sharp from 'sharp'

/**
 * Can *this* host draw the watermark?
 *
 * The same probe exists in `apps/worker/src/lib/image.ts`, and deliberately so: the answer
 * is a property of the machine, not of the settings. The worker composites the mark into
 * page images; the web app renders the admin preview. They can be different containers with
 * different fonts, and each has to answer for itself.
 *
 * librsvg fails silently on a missing face — it draws an empty layer — so a fontless host
 * would otherwise burn an invisible mark into every page while still changing every content
 * address. Rendering a known string and looking for any non-transparent pixel is the only
 * reliable test.
 */
let probe: Promise<boolean> | undefined

export const watermarkFontAvailable = async (): Promise<boolean> => {
  probe ??= (async () => {
    try {
      const svg = watermarkSvg({
        width: 256,
        height: 64,
        fontSize: 32,
        margin: 8,
        x: 8,
        y: 40,
        anchor: 'start',
        gravity: 'north',
        strokeWidth: 5,
        opacity: 1,
        text: 'palscans.org',
      })
      const { data, info } = await sharp(Buffer.from(svg))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      for (let i = 3; i < data.length; i += info.channels) if (data[i] !== 0) return true
      return false
    } catch {
      return false
    }
  })()
  return probe
}
