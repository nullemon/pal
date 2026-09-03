export {
  type BotOptions,
  clamp,
  createDiscordBot,
  DISCORD_API,
  DiscordBot,
  type DiscordEmbed,
  type DiscordMessage,
  type DiscordResult,
  discordConfigured,
  postWebhook,
} from './client'
export {
  BRAND_COLOR,
  type ChapterEmbedInput,
  chapterUrl,
  newChapterEmbed,
  newChapterMessage,
  testMessage,
} from './embed'
export {
  countPendingCodes,
  type DiscordLink,
  generateCode,
  getLink,
  issueCode,
  LINK_CODE_LENGTH,
  LINK_CODE_TTL_MS,
  linkedAccounts,
  normaliseCode,
  type RedeemResult,
  redeemCode,
  unlink,
} from './link'
export { activePlanIds, type RoleDiff, type RoleSyncSummary, roleDiff, syncRoles } from './roles'
