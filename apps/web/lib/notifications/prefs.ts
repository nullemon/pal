import { notificationPrefs } from '@palscans/db'
import { inArray } from 'drizzle-orm'
import { NOTIFICATION_CHANNELS, NOTIFICATION_KINDS } from '../auth/schemas'
import type { NotifyDb } from './types'

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]

export { NOTIFICATION_CHANNELS, NOTIFICATION_KINDS }

export const isNotificationKind = (v: unknown): v is NotificationKind =>
  typeof v === 'string' && (NOTIFICATION_KINDS as readonly string[]).includes(v)

export const isNotificationChannel = (v: unknown): v is NotificationChannel =>
  typeof v === 'string' && (NOTIFICATION_CHANNELS as readonly string[]).includes(v)

/** A stored `notification_prefs` row (only the three columns that decide anything). */
export interface PrefRow {
  userId: number
  kind: string
  channel: string
  enabled: boolean
}

/**
 * The preference matrix (docs/17 §D "per-kind × per-channel preferences … honoured by every
 * sender").
 *
 * Rows are sparse: `/me/notifications` writes only what the reader touched, so **a missing
 * row means the default**, and the default is on. A sender therefore asks this function
 * rather than looking for a row, and an unknown kind or channel is never sent (a typo in a
 * job must not fan out to everyone).
 */
export const prefAllows = (
  rows: readonly PrefRow[],
  userId: number,
  kind: string,
  channel: string,
): boolean => {
  if (!isNotificationKind(kind) || !isNotificationChannel(channel)) return false
  const row = rows.find((r) => r.userId === userId && r.kind === kind && r.channel === channel)
  return row ? row.enabled : true
}

/** The same decision for one user's rows, when the caller already narrowed by user. */
export const prefAllowsFor = (
  rows: readonly Pick<PrefRow, 'kind' | 'channel' | 'enabled'>[],
  kind: string,
  channel: string,
): boolean =>
  prefAllows(
    rows.map((r) => ({ ...r, userId: 0 })),
    0,
    kind,
    channel,
  )

/** Keep only the users who allow `kind` on `channel`; order is preserved. */
export const filterByPref = (
  rows: readonly PrefRow[],
  userIds: readonly number[],
  kind: string,
  channel: string,
): number[] => userIds.filter((id) => prefAllows(rows, id, kind, channel))

/** Load the stored rows for a set of users (sparse — see `prefAllows`). */
export const loadPrefs = async (db: NotifyDb, userIds: readonly number[]): Promise<PrefRow[]> => {
  if (userIds.length === 0) return []
  const rows = await db
    .select({
      userId: notificationPrefs.userId,
      kind: notificationPrefs.kind,
      channel: notificationPrefs.channel,
      enabled: notificationPrefs.enabled,
    })
    .from(notificationPrefs)
    .where(inArray(notificationPrefs.userId, [...userIds]))
  return rows
}

/** Users (of `userIds`) who allow `kind` on `channel`, read straight from the database. */
export const recipientsFor = async (
  db: NotifyDb,
  userIds: readonly number[],
  kind: string,
  channel: string,
): Promise<number[]> => filterByPref(await loadPrefs(db, userIds), userIds, kind, channel)
