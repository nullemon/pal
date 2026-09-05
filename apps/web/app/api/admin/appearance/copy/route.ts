import { normalizeCopyOverrides } from '@palscans/core/copy'
import { getDb } from '@palscans/db'
import { copySettingSchema } from '@/components/admin/schemas-copy'
import { audit } from '@/components/admin/server/audit'
import { purgeSettings } from '@/components/admin/server/cache'
import { ok, parseJson, withPermission } from '@/lib/auth'
import {
  COPY_SETTING_KEY,
  FORMATTING_SETTING_KEY,
  loadSiteCopy,
  saveCopySetting,
} from '@/lib/copy/settings'

/**
 * PUT /api/admin/appearance/copy — Appearance → Copy and → Formatting (docs/15).
 *
 * Two rows in the generic `settings` table, written together because the screen saves them
 * together. `normalizeCopyOverrides` runs after validation as well as inside it: it is what
 * drops a field the operator has reset to the shipped wording, so the stored document only
 * ever holds strings that actually differ — which keeps `settings.copy` from growing into a
 * second copy of the catalogue, and keeps the payload the public pages ship to the browser
 * at `{}` for a site nobody has customised.
 *
 * `purgeSettings()` revalidates the `settings` tag every public read is tagged with, so a
 * save is live on the next request rather than after the 60s window.
 */
export const PUT = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, copySettingSchema)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  const before = await loadSiteCopy(db)
  const overrides = normalizeCopyOverrides(parsed.data.copy)
  const formatting = parsed.data.formatting

  await saveCopySetting(db, COPY_SETTING_KEY, overrides, user.id)
  await saveCopySetting(db, FORMATTING_SETTING_KEY, formatting, user.id)
  purgeSettings()

  await audit({
    actorId: user.id,
    action: 'settings.copy',
    targetType: 'settings',
    before: { copy: before.overrides, formatting: before.formatting },
    after: { copy: overrides, formatting },
    request,
  })
  return ok({ copy: overrides, formatting })
})
