import { notificationDeliveries } from '@palscans/db'
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import type { NotifyDb } from './types'

/**
 * The delivery ledger (docs/17 §D "recent sends and failures"). Every channel writes one row
 * per attempt — including the ones it *skipped* because the reader turned the channel off,
 * so the admin screen can answer "why did this reader not get it?" without guessing.
 *
 * It doubles as the idempotency key: `dedupeKey` is stable per fan-out
 * (`chapter:412:push`), so a job that runs twice sends once.
 */
export type DeliveryStatus = 'sent' | 'failed' | 'skipped'

export interface DeliveryInput {
  userId?: number | null
  notificationId?: number | null
  kind: string
  channel: string
  status: DeliveryStatus
  /** Non-identifying handle: push endpoint host, mail domain, webhook name, Discord id. */
  target?: string | null
  detail?: string | null
  dedupeKey?: string | null
}

const MAX_DETAIL = 500

export const recordDeliveries = async (
  db: NotifyDb,
  rows: readonly DeliveryInput[],
): Promise<void> => {
  if (rows.length === 0) return
  await db.insert(notificationDeliveries).values(
    rows.map((r) => ({
      userId: r.userId ?? null,
      notificationId: r.notificationId ?? null,
      kind: r.kind,
      channel: r.channel,
      status: r.status,
      target: r.target ?? null,
      detail: r.detail ? r.detail.slice(0, MAX_DETAIL) : null,
      dedupeKey: r.dedupeKey ?? null,
    })),
  )
}

export const recordDelivery = (db: NotifyDb, row: DeliveryInput): Promise<void> =>
  recordDeliveries(db, [row])

/** Has this fan-out already run? (Any row at all, whatever its status.) */
export const alreadyDelivered = async (db: NotifyDb, dedupeKey: string): Promise<boolean> => {
  const [row] = await db
    .select({ id: notificationDeliveries.id })
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.dedupeKey, dedupeKey))
    .limit(1)
  return !!row
}

/** The subset of `keys` that have already been delivered — one query for a whole batch. */
export const deliveredKeys = async (
  db: NotifyDb,
  keys: readonly string[],
): Promise<Set<string>> => {
  if (keys.length === 0) return new Set()
  const rows = await db
    .selectDistinct({ key: notificationDeliveries.dedupeKey })
    .from(notificationDeliveries)
    .where(inArray(notificationDeliveries.dedupeKey, [...keys]))
  return new Set(rows.map((r) => r.key).filter((k): k is string => k !== null))
}

export interface DeliveryRow {
  id: number
  userId: number | null
  kind: string
  channel: string
  status: string
  target: string | null
  detail: string | null
  createdAt: Date
}

export const recentDeliveries = async (
  db: NotifyDb,
  opts: { limit?: number; channel?: string; status?: DeliveryStatus } = {},
): Promise<DeliveryRow[]> => {
  const where = [
    opts.channel ? eq(notificationDeliveries.channel, opts.channel) : undefined,
    opts.status ? eq(notificationDeliveries.status, opts.status) : undefined,
  ].filter((c) => c !== undefined)
  return db
    .select({
      id: notificationDeliveries.id,
      userId: notificationDeliveries.userId,
      kind: notificationDeliveries.kind,
      channel: notificationDeliveries.channel,
      status: notificationDeliveries.status,
      target: notificationDeliveries.target,
      detail: notificationDeliveries.detail,
      createdAt: notificationDeliveries.createdAt,
    })
    .from(notificationDeliveries)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(notificationDeliveries.createdAt))
    .limit(Math.min(opts.limit ?? 30, 200))
}

export interface DeliveryTotals {
  channel: string
  status: string
  n: number
}

/** Counts per channel × status over a window, for the admin screen's summary row. */
export const deliveryTotals = async (db: NotifyDb, sinceDays = 7): Promise<DeliveryTotals[]> => {
  const since = new Date(Date.now() - sinceDays * 86_400_000)
  return db
    .select({
      channel: notificationDeliveries.channel,
      status: notificationDeliveries.status,
      n: sql<number>`count(*)::int`,
    })
    .from(notificationDeliveries)
    .where(gte(notificationDeliveries.createdAt, since))
    .groupBy(notificationDeliveries.channel, notificationDeliveries.status)
}
