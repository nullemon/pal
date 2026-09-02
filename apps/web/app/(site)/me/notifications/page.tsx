import { messages } from '@palscans/core/messages'
import { getDb, notificationPrefs, notifications } from '@palscans/db'
import { EmptyState } from '@palscans/ui'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { Metadata } from 'next'
import { z } from 'zod'
import { NOTIFICATION_CHANNELS, NOTIFICATION_KINDS } from '@/lib/auth/schemas'
import {
  MarkAllReadButton,
  type NotificationItem,
  NotificationRow,
  type PrefRow,
  PrefsMatrix,
  unreadLabel,
} from '../_components/NotificationsClient'
import { PageTitle, Section } from '../_components/Section'
import { requireAccount } from '../_lib'

export const metadata: Metadata = { title: messages.me.notifications.title }

/** Whatever the worker puts in `payload`, only these keys are rendered (never raw HTML). */
const payloadSchema = z
  .object({
    title: z.string().max(200).optional(),
    body: z.string().max(500).optional(),
    href: z.string().max(500).optional(),
    url: z.string().max(500).optional(),
    seriesTitle: z.string().max(200).optional(),
    seriesSlug: z.string().max(200).optional(),
    chapterNumber: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough()

const kindLabel = (kind: string): string =>
  (messages.me.notifications.kinds as Record<string, string>)[kind] ??
  messages.me.notifications.fallback

const toItem = (row: {
  id: number
  kind: string
  payload: unknown
  readAt: Date | null
  createdAt: Date
}): NotificationItem => {
  const p = payloadSchema.safeParse(row.payload).data ?? {}
  const chapter = p.chapterNumber !== undefined ? ` · Ch. ${p.chapterNumber}` : ''
  const title = p.title ?? (p.seriesTitle ? `${p.seriesTitle}${chapter}` : kindLabel(row.kind))
  const rawHref =
    p.href ??
    p.url ??
    (p.seriesSlug
      ? `/series/${p.seriesSlug}${p.chapterNumber !== undefined ? `/chapter-${p.chapterNumber}` : ''}`
      : null)
  const href = rawHref && rawHref.startsWith('/') && !rawHref.startsWith('//') ? rawHref : null
  return {
    id: row.id,
    kind: row.kind,
    title,
    body: p.body ?? (p.title ? kindLabel(row.kind) : null),
    href,
    read: !!row.readAt,
    createdAt: row.createdAt.toISOString(),
  }
}

export default async function NotificationsPage() {
  const user = await requireAccount('/me/notifications')
  const db = await getDb()
  const [rows, [unreadRow], prefRows] = await Promise.all([
    db
      .select({
        id: notifications.id,
        kind: notifications.kind,
        payload: notifications.payload,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(eq(notifications.userId, user.id))
      .orderBy(desc(notifications.createdAt))
      .limit(50),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt))),
    db.select().from(notificationPrefs).where(eq(notificationPrefs.userId, user.id)),
  ])
  const unread = unreadRow?.n ?? 0
  const items = rows.map(toItem)
  const prefs: PrefRow[] = NOTIFICATION_KINDS.flatMap((kind) =>
    NOTIFICATION_CHANNELS.map((channel) => ({
      kind,
      channel,
      enabled: prefRows.find((r) => r.kind === kind && r.channel === channel)?.enabled ?? true,
    })),
  )

  return (
    <>
      <PageTitle title={messages.me.notifications.title}>
        <div className="flex items-center gap-3">
          {unread > 0 ? (
            <span className="text-[13px] text-fg-muted">{unreadLabel(unread)}</span>
          ) : null}
          <MarkAllReadButton unread={unread} />
        </div>
      </PageTitle>
      <div className="flex flex-col gap-6">
        {items.length === 0 ? (
          <EmptyState title={messages.account.emptyNotifications} />
        ) : (
          <ol className="divide-y divide-line-soft overflow-hidden rounded-lg border border-line bg-surface-1">
            {items.map((item) => (
              <li key={item.id}>
                <NotificationRow item={item} />
              </li>
            ))}
          </ol>
        )}
        <Section id="preferences" title={messages.me.notifications.preferences}>
          <PrefsMatrix initial={prefs} />
        </Section>
      </div>
    </>
  )
}
