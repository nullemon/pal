import { messages } from '@palscans/core/messages'
import {
  discordLinks,
  getDb,
  notificationDigestState,
  plans,
  pushSubscriptions,
  users,
} from '@palscans/db'
import { eq, isNotNull, sql } from 'drizzle-orm'
import type { Metadata } from 'next'
import {
  EmptyRow,
  PageHeader,
  Panel,
  PanelHeader,
  Pill,
  type PillTone,
  StatTile,
  Table,
  Td,
  Th,
  When,
} from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'
import { getMailer } from '@/lib/email'
import { discordRoleSyncStatus, discordStatus, getEnv, pushStatus } from '@/lib/env'
import {
  deliveryTotals,
  previewDigest,
  readNotificationSettings,
  recentDeliveries,
} from '@/lib/notifications'
import { NotificationsForm } from './_components/NotificationsForm'

export const metadata: Metadata = { title: messages.notify.admin.title }
export const dynamic = 'force-dynamic'

const m = messages.notify.admin

/** docs/17 §D: "what fires, to whom". Read straight off the senders, not a hand-written list. */
const WHAT_FIRES = [
  { event: m.eventNewChapter, audience: m.audienceBookmarkers, channels: 'in app · push · discord' },
  { event: m.eventDigest, audience: m.audienceDigest, channels: 'email' },
  { event: m.eventReply, audience: m.audienceReply, channels: 'in app · push' },
  { event: m.eventReaction, audience: m.audienceReaction, channels: 'in app' },
  { event: m.eventAnnouncement, audience: m.audienceAnnouncement, channels: 'in app · discord' },
] as const

const statusTone: Record<string, PillTone> = { sent: 'ok', failed: 'danger', skipped: 'neutral' }

export default async function AdminNotificationsPage() {
  const user = await withPermission('settings.write', { returnTo: '/admin/notifications' })
  const db = await getDb()
  const env = getEnv()
  const [settings, deliveries, totals, planRows, devices, digestOptIn, linked] = await Promise.all([
    readNotificationSettings(db),
    recentDeliveries(db, { limit: 30 }),
    deliveryTotals(db, 7),
    db.select({ id: plans.id, name: plans.name }).from(plans),
    db.select({ n: sql<number>`count(*)::int` }).from(pushSubscriptions),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(notificationDigestState)
      .where(sql`${notificationDigestState.frequency} <> 'off'`),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(discordLinks)
      .where(isNotNull(discordLinks.discordId)),
  ])
  const [me] = await db
    .select({ displayName: users.displayName, username: users.username })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1)
  // The preview is the operator's *own* digest over the last week — a real mail, real data.
  const { digest, rendered } = await previewDigest(db, user.id, {
    settings,
    site: { siteUrl: env.SITE_URL, siteName: env.SITE_NAME, cdnUrl: env.PUBLIC_CDN_URL },
    displayName: me?.displayName ?? me?.username ?? messages.notify.digest.reader,
  })
  const total = (channel: string, status: string) =>
    totals.find((t) => t.channel === channel && t.status === status)?.n ?? 0

  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />

      <div className="mt-3.5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={`${m.sent} · ${m.last7}`} value={total('push', 'sent')} hint="push" />
        <StatTile label={`${m.sent} · ${m.last7}`} value={total('email', 'sent')} hint="email" />
        <StatTile label={`${m.sent} · ${m.last7}`} value={total('discord', 'sent')} hint="discord" />
        <StatTile
          label={`${m.failed} · ${m.last7}`}
          value={total('push', 'failed') + total('email', 'failed') + total('discord', 'failed')}
          tone="danger"
        />
      </div>

      <div className="mt-3.5 flex flex-col gap-3.5">
        <Panel>
          <PanelHeader title={m.whatFires} hint={m.whatFiresHint} />
          <Table>
            <thead>
              <tr>
                <Th>{m.event}</Th>
                <Th>{m.audience}</Th>
                <Th>{m.channels}</Th>
              </tr>
            </thead>
            <tbody>
              {WHAT_FIRES.map((row) => (
                <tr key={row.event}>
                  <Td className="font-semibold">{row.event}</Td>
                  <Td className="text-fg-muted">{row.audience}</Td>
                  <Td className="font-mono text-[12px] text-fg-muted">{row.channels}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>

        <NotificationsForm
          initial={settings}
          availability={{
            push: pushStatus(),
            discord: discordStatus(),
            roleSync: discordRoleSyncStatus(),
            mailer: getMailer().kind,
          }}
          plans={planRows}
          counts={{
            devices: devices[0]?.n ?? 0,
            digest: digestOptIn[0]?.n ?? 0,
            linked: linked[0]?.n ?? 0,
          }}
        />

        <Panel>
          <PanelHeader
            title={m.previewPanel}
            hint={m.previewHint}
            aside={<span>{rendered.subject}</span>}
          />
          {digest.totalChapters === 0 ? (
            <p className="text-[13px] text-fg-muted">{m.previewEmpty}</p>
          ) : (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-bg p-3 font-mono text-[12px] leading-5 text-fg-muted">
              {rendered.text}
            </pre>
          )}
        </Panel>

        <Panel>
          <PanelHeader title={m.recent} hint={m.recentHint} />
          <Table>
            <thead>
              <tr>
                <Th>{m.when}</Th>
                <Th>{m.channel}</Th>
                <Th>{m.kind}</Th>
                <Th>{m.status}</Th>
                <Th>{m.user}</Th>
                <Th>{m.target}</Th>
                <Th>{m.detail}</Th>
              </tr>
            </thead>
            <tbody>
              {deliveries.length === 0 ? (
                <EmptyRow colSpan={7}>{m.noDeliveries}</EmptyRow>
              ) : (
                deliveries.map((d) => (
                  <tr key={d.id}>
                    <Td className="whitespace-nowrap text-fg-muted">
                      <When date={d.createdAt} />
                    </Td>
                    <Td className="font-mono text-[12px]">{d.channel}</Td>
                    <Td className="font-mono text-[12px] text-fg-muted">{d.kind}</Td>
                    <Td>
                      <Pill tone={statusTone[d.status] ?? 'neutral'}>{d.status}</Pill>
                    </Td>
                    <Td className="tabular-nums text-fg-muted">{d.userId ?? '—'}</Td>
                    <Td className="text-fg-muted">{d.target ?? '—'}</Td>
                    <Td className="max-w-[280px] truncate text-fg-subtle" >{d.detail ?? '—'}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </Panel>
      </div>
    </>
  )
}
