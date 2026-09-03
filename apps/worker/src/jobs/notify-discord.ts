import type { Db } from '@palscans/db'
import {
  createDiscordBot,
  type RoleSyncSummary,
  syncRoles,
} from '../../../web/lib/discord/index.js'
import type { NotificationSettings } from '../../../web/lib/notifications/index.js'
import { log } from '../lib/log.js'

/**
 * Discord tier role sync (docs/17 §D). Inert without a bot token and guild id — from the
 * admin panel first and `DISCORD_BOT_TOKEN` / `DISCORD_GUILD_ID` second (docs/19): the bot
 * reports `configured: false` and `syncRoles` returns without a single request, so a
 * deployment with no bot pays nothing for this pass.
 */
export const runRoleSyncPass = async (
  db: Db,
  settings: NotificationSettings,
): Promise<RoleSyncSummary> => {
  const bot = await createDiscordBot()
  if (!bot.configured || !settings.discord.enabled || !settings.discord.roleSync.enabled)
    return { configured: bot.configured, checked: 0, added: 0, removed: 0, failed: 0 }
  const summary = await syncRoles(db, { bot, settings })
  if (summary.added || summary.removed || summary.failed) log.info('discord role sync', summary)
  return summary
}
