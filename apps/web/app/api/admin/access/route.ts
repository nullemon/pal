import { getDb, getSetting, settings } from '@palscans/db'
import { z } from 'zod'
import { audit } from '@/components/admin/server/audit'
import { purgeSettings } from '@/components/admin/server/cache'
import { ok, parseJson, withPermission } from '@/lib/auth'
import {
  ACCESS_SETTING_KEY,
  accessSettingSchema,
  normaliseDomains,
  readAccessSetting,
  readMinAccountAgeMinutes,
  readRegistrationMode,
  writeMinAccountAgeMinutes,
} from '@/lib/auth/invites'

/**
 * PUT /api/admin/access — docs/17 §C. Writes three documents in one save: the registration
 * mode back into `settings.site` (where it already lives), the domain / verification /
 * Turnstile switches into `settings.access`, and the comment minimum-account-age into
 * `settings.comments` so both screens read one value.
 */
export const accessPayloadSchema = z.object({
  registration: z.enum(['open', 'invite', 'closed']),
  access: accessSettingSchema,
  minAccountAgeMinutes: z
    .number()
    .int()
    .min(0)
    .max(60 * 24 * 30),
})
export type AccessPayload = z.infer<typeof accessPayloadSchema>

export const PUT = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, accessPayloadSchema)
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  const access = { ...body.access, domains: normaliseDomains(body.access.domains) }

  const db = await getDb()
  const now = new Date()
  const beforeSite = await getSetting<Record<string, unknown>>(db, 'site', {})
  const before = {
    registration: await readRegistrationMode(),
    access: await readAccessSetting(),
    minAccountAgeMinutes: await readMinAccountAgeMinutes(),
  }

  const site = { ...beforeSite, registration: body.registration }
  await db
    .insert(settings)
    .values({ key: 'site', value: site, updatedBy: user.id, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: site, updatedBy: user.id, updatedAt: now },
    })
  await db
    .insert(settings)
    .values({ key: ACCESS_SETTING_KEY, value: access, updatedBy: user.id, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: access, updatedBy: user.id, updatedAt: now },
    })
  await writeMinAccountAgeMinutes(body.minAccountAgeMinutes, user.id)
  purgeSettings()

  const after = {
    registration: body.registration,
    access,
    minAccountAgeMinutes: body.minAccountAgeMinutes,
  }
  await audit({
    actorId: user.id,
    action: 'settings.access',
    targetType: 'settings',
    before,
    after,
  })
  return ok(after)
})
