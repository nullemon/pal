import { afterEach, describe, expect, it } from 'vitest'
import {
  configureCredentials,
  credentialsInstalled,
  credentialValue,
  credentialValues,
  storedCredentials,
} from '../credentials.js'

/**
 * The slot the web app and the worker both install a reader into (docs/19). What is being
 * pinned here is the precedence rule every shared module depends on: stored wins, the
 * environment is the fallback, and a resolver that is missing or broken degrades to the
 * environment instead of taking a feature down.
 */

const env = { DISCORD_BOT_TOKEN: 'token-from-env', VAPID_SUBJECT: 'mailto:env@example.org' }

afterEach(() => configureCredentials(undefined))

describe('the credential slot', () => {
  it('is environment-only until a reader is installed', async () => {
    expect(credentialsInstalled()).toBe(false)
    expect(await storedCredentials()).toEqual({})
    expect(await credentialValue('discord.bot_token', 'DISCORD_BOT_TOKEN', env)).toBe(
      'token-from-env',
    )
  })

  it('prefers a stored value over the environment', async () => {
    configureCredentials(async () => ({ 'discord.bot_token': 'token-from-panel' }))
    expect(credentialsInstalled()).toBe(true)
    expect(await credentialValue('discord.bot_token', 'DISCORD_BOT_TOKEN', env)).toBe(
      'token-from-panel',
    )
  })

  it('treats an empty or whitespace stored value as unset', async () => {
    configureCredentials(async () => ({ 'discord.bot_token': '   ' }))
    expect(await credentialValue('discord.bot_token', 'DISCORD_BOT_TOKEN', env)).toBe(
      'token-from-env',
    )
  })

  it('yields the empty string when neither source has the value', async () => {
    configureCredentials(async () => ({}))
    expect(await credentialValue('push.vapid_private_key', 'VAPID_PRIVATE_KEY', env)).toBe('')
  })

  it('falls back to the environment when the reader throws', async () => {
    configureCredentials(async () => {
      throw new Error('database is down')
    })
    expect(await credentialValue('discord.bot_token', 'DISCORD_BOT_TOKEN', env)).toBe(
      'token-from-env',
    )
  })

  it('resolves a batch from one read of the store', async () => {
    let reads = 0
    configureCredentials(async () => {
      reads += 1
      return { 'discord.bot_token': 'token-from-panel' }
    })
    const values = await credentialValues(
      {
        token: ['discord.bot_token', 'DISCORD_BOT_TOKEN'],
        subject: ['push.vapid_subject', 'VAPID_SUBJECT'],
        guild: ['discord.guild_id', 'DISCORD_GUILD_ID'],
      },
      env,
    )
    expect(values).toEqual({
      token: 'token-from-panel',
      subject: 'mailto:env@example.org',
      guild: '',
    })
    expect(reads).toBe(1)
  })
})
