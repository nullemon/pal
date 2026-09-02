import { discordStatus, notificationEnv } from '../notifications/config'
import type { FetchLike } from '../notifications/types'

/**
 * Discord transport (docs/17 §D). Two halves, deliberately separate:
 *
 * - **Channel webhooks** are a URL the operator pastes in. They need no bot and no token,
 *   so `postWebhook` works on a deployment that has never heard of a bot.
 * - **The bot API** (DMs, role sync, resolving a linked account) needs `DISCORD_BOT_TOKEN`.
 *   Without it every call returns `{ ok: false, error: 'not_configured' }` — it never throws
 *   and never reaches the network, which is also what keeps the tests offline.
 *
 * `fetch` is injected everywhere so no test ever leaves the process.
 */
export const DISCORD_API = 'https://discord.com/api/v10'

export interface DiscordResult {
  ok: boolean
  status?: number
  error?: string
}

const TIMEOUT_MS = 8_000

/** Discord embeds cap most fields at 256/4096; keep well inside and never send a huge body. */
export const clamp = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`

export interface DiscordEmbed {
  title: string
  url?: string
  description?: string
  color?: number
  timestamp?: string
  footer?: { text: string }
  thumbnail?: { url: string }
  fields?: { name: string; value: string; inline?: boolean }[]
}

export interface DiscordMessage {
  content?: string
  username?: string
  embeds?: DiscordEmbed[]
}

/** POST a message to a channel webhook URL. */
export const postWebhook = async (
  url: string,
  message: DiscordMessage,
  fetchImpl: FetchLike = fetch,
): Promise<DiscordResult> => {
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, status: res.status, error: clamp(body || `http ${res.status}`, 300) }
    }
    return { ok: true, status: res.status }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'request failed' }
  }
}

export interface BotOptions {
  token?: string | undefined
  guildId?: string | undefined
  fetchImpl?: FetchLike
}

/** The bot half. Construct it anywhere; ask `configured` before promising the operator anything. */
export class DiscordBot {
  readonly configured: boolean
  private readonly token: string | undefined
  private readonly guildId: string | undefined
  private readonly fetchImpl: FetchLike

  constructor(opts: BotOptions = {}) {
    const env = notificationEnv()
    this.token = opts.token ?? env.DISCORD_BOT_TOKEN
    this.guildId = opts.guildId ?? env.DISCORD_GUILD_ID
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.configured = !!this.token
  }

  private async call(
    path: string,
    init: { method: string; body?: unknown } = { method: 'GET' },
  ): Promise<DiscordResult & { json?: unknown }> {
    if (!this.token) return { ok: false, error: 'not_configured' }
    try {
      const res = await this.fetchImpl(`${DISCORD_API}${path}`, {
        method: init.method,
        headers: {
          authorization: `Bot ${this.token}`,
          ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        return { ok: false, status: res.status, error: clamp(body || `http ${res.status}`, 300) }
      }
      const json = await res.json().catch(() => undefined)
      return { ok: true, status: res.status, json }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'request failed' }
    }
  }

  /** Open (or reuse) the DM channel with a user and post there. */
  async dm(discordId: string, message: DiscordMessage): Promise<DiscordResult> {
    const channel = await this.call('/users/@me/channels', {
      method: 'POST',
      body: { recipient_id: discordId },
    })
    if (!channel.ok) return channel
    const id = (channel.json as { id?: string } | undefined)?.id
    if (!id) return { ok: false, error: 'no dm channel' }
    return this.call(`/channels/${id}/messages`, { method: 'POST', body: message })
  }

  async addRole(discordId: string, roleId: string): Promise<DiscordResult> {
    if (!this.guildId) return { ok: false, error: 'not_configured' }
    return this.call(`/guilds/${this.guildId}/members/${discordId}/roles/${roleId}`, {
      method: 'PUT',
    })
  }

  async removeRole(discordId: string, roleId: string): Promise<DiscordResult> {
    if (!this.guildId) return { ok: false, error: 'not_configured' }
    return this.call(`/guilds/${this.guildId}/members/${discordId}/roles/${roleId}`, {
      method: 'DELETE',
    })
  }
}

export const discordConfigured = (): boolean => discordStatus().configured
