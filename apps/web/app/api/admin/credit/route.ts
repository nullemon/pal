import { randomUUID } from 'node:crypto'
import { creditSettingsSchema } from '@palscans/core/credit'
import { z } from 'zod'
import { audit } from '@/components/admin/server/audit'
import { purgeCatalog } from '@/components/admin/server/cache'
import { creditSettings, saveCreditSettings } from '@/components/admin/server/credit'
import { ok, parseJson, withPermission } from '@/lib/auth'
import { presignUpload } from '@/lib/storage'

/**
 * /api/admin/credit — the credit page's settings (docs/03).
 *
 * `settings.write` rather than a content permission: this decides how every chapter's
 * second page looks, which is the same kind of decision as the watermark and the theme, and
 * not something an uploader should change while adding a chapter.
 */

const assetSchema = z.object({
  kind: z.enum(['overlay', 'background']),
  type: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  bytes: z
    .number()
    .int()
    .positive()
    .max(12 * 1024 * 1024),
})

export const GET = withPermission('settings.write', async () =>
  ok({ settings: await creditSettings() }),
)

export const PUT = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, creditSettingsSchema)
  if (!parsed.ok) return parsed.response
  const before = await creditSettings()
  /**
   * The cutoff is stamped here, not sent by the client.
   *
   * It is the answer to "which chapters get a card", and it has to be the moment the feature
   * was actually switched on — not a value a form could carry back stale, and not a value
   * that moves every time an unrelated setting is saved. Turning it off clears it, so
   * switching it on again starts a fresh line rather than retroactively claiming everything
   * since the first time.
   */
  const enabledAt = !parsed.data.enabled
    ? ''
    : before.enabled && before.enabledAt
      ? before.enabledAt
      : new Date().toISOString()
  const settings = await saveCreditSettings({ ...parsed.data, enabledAt }, user.id)
  await audit({
    actorId: user.id,
    action: 'credit.settings',
    targetType: 'setting',
    targetId: null,
    before: { enabled: before.enabled, overlays: before.overlays.length },
    after: { enabled: settings.enabled, overlays: settings.overlays.length, enabledAt },
  })
  // The cards are cached hard by their own route; a settings change is the one thing that
  // has to reach them.
  purgeCatalog()
  return ok({ settings })
})

/**
 * A presigned PUT for an overlay or a background.
 *
 * Content-addressed by a fresh id rather than by the file name: two series called "cover.png"
 * must not overwrite one another, and replacing a background should produce a new key so
 * caches that already hold the old card go and fetch the new one.
 */
export const POST = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, assetSchema)
  if (!parsed.ok) return parsed.response
  const ext =
    parsed.data.type === 'image/png' ? 'png' : parsed.data.type === 'image/webp' ? 'webp' : 'jpg'
  const key = `credit/${parsed.data.kind}/${randomUUID()}.${ext}`
  const signed = await presignUpload(key, parsed.data.type, user.id, parsed.data.bytes)
  return ok({ key, url: signed.url, method: signed.method, headers: signed.headers })
})
