import { discordLinks, subscriptions } from '@palscans/db'
import { eq, inArray, sql } from 'drizzle-orm'
import { recordDeliveries } from '../notifications/deliveries'
import type { NotificationSettings } from '../notifications/settings'
import type { NotifyDb } from '../notifications/types'
import type { DiscordBot } from './client'
import { linkedAccounts } from './link'

/**
 * Tier role sync (docs/17 §D). The operator maps a plan id (`plans.id`, e.g. `premium`) to a
 * Discord role id on `Admin → Community → Notifications`; this walks every linked account,
 * works out the role its live subscription earns, and adds or removes only the roles the
 * mapping names — a role the operator did not map is never touched, so hand-assigned roles
 * survive a sync.
 */

export interface RoleDiff {
  add: string[]
  remove: string[]
}

/**
 * `managed` is the full set of mapped role ids; `desired` is what this account should hold.
 * Roles outside `managed` are none of our business.
 */
export const roleDiff = (
  current: readonly string[],
  desired: readonly string[],
  managed: readonly string[],
): RoleDiff => {
  const managedSet = new Set(managed)
  const desiredSet = new Set(desired.filter((r) => managedSet.has(r)))
  const currentSet = new Set(current.filter((r) => managedSet.has(r)))
  return {
    add: [...desiredSet].filter((r) => !currentSet.has(r)),
    remove: [...currentSet].filter((r) => !desiredSet.has(r)),
  }
}

/** Statuses that still earn the perk (mirrors the `subscriptions_active_user_idx` predicate). */
const LIVE_STATUSES = ['active', 'trialing', 'past_due']

export const activePlanIds = async (
  db: NotifyDb,
  userIds: readonly number[],
): Promise<Map<number, string>> => {
  if (userIds.length === 0) return new Map()
  const rows = await db
    .select({ userId: subscriptions.userId, planId: subscriptions.planId })
    .from(subscriptions)
    .where(
      sql`${inArray(subscriptions.userId, [...userIds])} and ${subscriptions.status} in ${sql.raw(
        `(${LIVE_STATUSES.map((s) => `'${s}'`).join(', ')})`,
      )}`,
    )
  return new Map(rows.map((r) => [r.userId, r.planId]))
}

export interface RoleSyncSummary {
  configured: boolean
  checked: number
  added: number
  removed: number
  failed: number
}

export const syncRoles = async (
  db: NotifyDb,
  opts: { bot: DiscordBot; settings: NotificationSettings; limit?: number },
): Promise<RoleSyncSummary> => {
  const cfg = opts.settings.discord.roleSync
  const managed = Object.values(cfg.roles).filter((r) => r.length > 0)
  if (!opts.bot.configured || !cfg.enabled || managed.length === 0)
    return { configured: opts.bot.configured, checked: 0, added: 0, removed: 0, failed: 0 }
  const accounts = await linkedAccounts(db, opts.limit ?? 500)
  const plans = await activePlanIds(
    db,
    accounts.map((a) => a.userId),
  )
  let added = 0
  let removed = 0
  let failed = 0
  const now = new Date()
  for (const account of accounts) {
    const plan = plans.get(account.userId)
    const desired = plan && cfg.roles[plan] ? [cfg.roles[plan]] : []
    const diff = roleDiff(account.syncedRoles, desired, managed)
    if (diff.add.length === 0 && diff.remove.length === 0) continue
    const held = new Set(account.syncedRoles)
    let anyFailure = false
    for (const role of diff.add) {
      const res = await opts.bot.addRole(account.discordId, role)
      if (res.ok) {
        held.add(role)
        added += 1
      } else {
        anyFailure = true
        failed += 1
        await recordDeliveries(db, [
          {
            userId: account.userId,
            kind: 'role_sync',
            channel: 'discord',
            status: 'failed',
            target: role,
            detail: res.error ?? null,
          },
        ])
      }
    }
    for (const role of diff.remove) {
      const res = await opts.bot.removeRole(account.discordId, role)
      if (res.ok) {
        held.delete(role)
        removed += 1
      } else {
        anyFailure = true
        failed += 1
        await recordDeliveries(db, [
          {
            userId: account.userId,
            kind: 'role_sync',
            channel: 'discord',
            status: 'failed',
            target: role,
            detail: res.error ?? null,
          },
        ])
      }
    }
    await db
      .update(discordLinks)
      .set({ syncedRoles: [...held], rolesSyncedAt: now, updatedAt: now })
      .where(eq(discordLinks.userId, account.userId))
    if (!anyFailure)
      await recordDeliveries(db, [
        {
          userId: account.userId,
          kind: 'role_sync',
          channel: 'discord',
          status: 'sent',
          target: account.discordId,
          detail: `+${diff.add.length} -${diff.remove.length}`,
        },
      ])
  }
  return { configured: true, checked: accounts.length, added, removed, failed }
}
