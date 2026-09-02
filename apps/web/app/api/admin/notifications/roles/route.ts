import { messages } from '@palscans/core/messages'
import { getDb } from '@palscans/db'
import { audit } from '@/components/admin/server/audit'
import { fail, ok, withPermission } from '@/lib/auth'
import { DiscordBot, syncRoles } from '@/lib/discord'
import { discordRoleSyncStatus } from '@/lib/env'
import { readNotificationSettings } from '@/lib/notifications'

/**
 * POST /api/admin/notifications/roles — run the tier role sync now (docs/17 §D).
 *
 * The worker runs the same pass on a schedule; this is the "did my mapping work?" button.
 * Without `DISCORD_BOT_TOKEN` + `DISCORD_GUILD_ID` it answers 503 rather than pretending.
 */
export const POST = withPermission('settings.write', async (request, _ctx, user) => {
  const status = discordRoleSyncStatus()
  if (!status.configured)
    return fail(
      503,
      'discord_not_configured',
      messages.notify.notConfiguredHint.replace('{keys}', status.missing.join(', ')),
    )
  const db = await getDb()
  const settings = await readNotificationSettings(db)
  const summary = await syncRoles(db, { bot: new DiscordBot(), settings })
  await audit({
    actorId: user.id,
    action: 'notifications.role_sync',
    targetType: 'settings',
    after: summary,
    request,
  })
  return ok({
    ...summary,
    message: messages.notify.admin.syncDone
      .replace('{n}', String(summary.checked))
      .replace('{added}', String(summary.added))
      .replace('{removed}', String(summary.removed)),
  })
})
