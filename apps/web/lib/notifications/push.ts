import { pushSubscriptions } from '@palscans/db'
import { and, eq, inArray } from 'drizzle-orm'
import { type PushConfig, pushConfig } from './config'
import { type DeliveryInput, recordDeliveries } from './deliveries'
import type { NotifyDb } from './types'

/**
 * Web push (docs/17 §D). The reader subscribes from `/me/notifications`, the browser hands
 * back an endpoint + two keys, and those become one `push_subscriptions` row. Sending is
 * `web-push` with the VAPID pair from the environment; with the keys unset nothing here
 * throws — `sendPush` reports `{ configured: false }` and every caller shows "not configured".
 */

/** What the service worker (`public/sw.js`) expects in `event.data`. */
export interface PushPayload {
  title: string
  body: string
  /** Same-origin path the notification opens. */
  url: string
  /** Collapses replacements in the OS tray, e.g. `series:12`. */
  tag?: string
  kind?: string
  icon?: string
  badge?: string
}

export interface StoredSubscription {
  id: number
  userId: number
  endpoint: string
  p256dh: string
  auth: string
}

export interface SendResult {
  ok: boolean
  statusCode?: number
  error?: string
}

export interface PushSender {
  send(sub: StoredSubscription, payload: PushPayload, ttlSeconds: number): Promise<SendResult>
}

/**
 * The real sender. `web-push` is imported lazily so an unconfigured deployment never loads
 * it, and so tests can pass their own `PushSender` and stay off the network entirely.
 */
export const webPushSender = (cfg: PushConfig): PushSender => ({
  async send(sub, payload, ttlSeconds) {
    try {
      const webpush = (await import('web-push')).default
      webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey)
      const res = await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: ttlSeconds },
      )
      return { ok: true, statusCode: res.statusCode }
    } catch (err) {
      const e = err as { statusCode?: number; body?: string; message?: string }
      return {
        ok: false,
        statusCode: typeof e.statusCode === 'number' ? e.statusCode : undefined,
        error: e.body || e.message || 'push failed',
      }
    }
  },
})

/** 404 / 410 mean the browser threw the subscription away — drop the row (see below). */
export const isGoneStatus = (status: number | undefined): boolean =>
  status === 404 || status === 410

/** The push endpoint's host is enough to tell FCM from Mozilla; the token is never stored here. */
export const endpointHost = (endpoint: string): string => {
  try {
    return new URL(endpoint).host
  } catch {
    return 'unknown'
  }
}

export const listSubscriptions = async (
  db: NotifyDb,
  userIds: readonly number[],
): Promise<StoredSubscription[]> => {
  if (userIds.length === 0) return []
  return db
    .select({
      id: pushSubscriptions.id,
      userId: pushSubscriptions.userId,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, [...userIds]))
}

export const countSubscriptions = async (db: NotifyDb, userId: number): Promise<number> =>
  (
    await db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
  ).length

export const saveSubscription = async (
  db: NotifyDb,
  input: {
    userId: number
    endpoint: string
    p256dh: string
    auth: string
    userAgent?: string | null
  },
): Promise<void> => {
  const now = new Date()
  await db
    .insert(pushSubscriptions)
    .values({
      userId: input.userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent ?? null,
      lastUsedAt: now,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      // The same endpoint can be re-issued to another account on a shared device.
      set: {
        userId: input.userId,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent ?? null,
        lastUsedAt: now,
        failedAt: null,
      },
    })
}

/**
 * Removing a subscription is a hard delete, on purpose: `push_subscriptions` is a
 * `(user, endpoint)` toggle row of exactly the kind docs/16 exempts — the row *is* the
 * permission, and the browser has already discarded its half. Nothing references it.
 */
export const deleteSubscription = async (
  db: NotifyDb,
  userId: number,
  endpoint: string,
): Promise<number> => {
  const rows = await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
    .returning({ id: pushSubscriptions.id })
  return rows.length
}

export const deleteSubscriptionsById = async (
  db: NotifyDb,
  ids: readonly number[],
): Promise<void> => {
  if (ids.length === 0) return
  await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, [...ids]))
}

export interface SendPushOptions {
  kind: string
  ttlSeconds?: number
  dedupeKey?: string | null
  /** Injected in tests; defaults to the `web-push` sender built from the environment. */
  sender?: PushSender
  config?: PushConfig | null
}

export interface SendPushSummary {
  configured: boolean
  sent: number
  failed: number
  /** Subscriptions dropped because the push service said the endpoint is gone. */
  pruned: number
}

/**
 * Send one payload to every subscription of every listed user, prune the dead endpoints and
 * write the ledger. Callers filter by preference *before* getting here (see `prefs.ts`);
 * this function only knows about endpoints.
 */
export const sendPush = async (
  db: NotifyDb,
  userIds: readonly number[],
  payload: PushPayload,
  opts: SendPushOptions,
): Promise<SendPushSummary> => {
  let sender = opts.sender
  if (!sender) {
    const cfg = opts.config !== undefined ? opts.config : pushConfig()
    // No VAPID keys: a silent, honest no-op rather than a throw (docs/17 §D).
    if (!cfg) return { configured: false, sent: 0, failed: 0, pruned: 0 }
    sender = webPushSender(cfg)
  }
  const subs = await listSubscriptions(db, userIds)
  if (subs.length === 0) return { configured: true, sent: 0, failed: 0, pruned: 0 }
  const ttl = opts.ttlSeconds ?? 86_400
  const ledger: DeliveryInput[] = []
  const gone: number[] = []
  let sent = 0
  let failed = 0
  for (const sub of subs) {
    const res = await sender.send(sub, payload, ttl)
    const base = {
      userId: sub.userId,
      kind: opts.kind,
      channel: 'push',
      target: endpointHost(sub.endpoint),
      dedupeKey: opts.dedupeKey ?? null,
    }
    if (res.ok) {
      sent += 1
      ledger.push({ ...base, status: 'sent' })
      continue
    }
    failed += 1
    if (isGoneStatus(res.statusCode)) gone.push(sub.id)
    ledger.push({
      ...base,
      status: 'failed',
      detail: `${res.statusCode ?? '—'} ${res.error ?? ''}`.trim(),
    })
  }
  await deleteSubscriptionsById(db, gone)
  await recordDeliveries(db, ledger)
  return { configured: true, sent, failed, pruned: gone.length }
}
