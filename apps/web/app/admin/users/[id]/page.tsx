import { can, formatChapterNumber } from '@palscans/core'
import { adminMessages } from '@palscans/core/messages/admin'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { UserActions } from '@/components/admin/client/UserActions'
import {
  idParam,
  pageSchema,
  parseSearch,
  type SearchParams,
} from '@/components/admin/server/params'
import { loadUserDetail } from '@/components/admin/server/users'
import { PageHeader, Panel, PanelHeader, Pill, When } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'
import { describeDevice } from '@/lib/auth/device'
import { listLoginEvents } from '@/lib/auth/login-events'
import { LoginHistory } from './LoginHistory'

export default async function UserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<SearchParams>
}) {
  const id = idParam.safeParse((await params).id)
  if (!id.success) notFound()
  const actor = await withPermission('user.read', { returnTo: `/admin/users/${id.data}` })
  const d = await loadUserDetail(id.data)
  if (!d) notFound()
  // docs/17 §C: the sign-in history sits under the sessions list, paginated on its own key.
  const { lp } = parseSearch(z.object({ lp: pageSchema }), await searchParams)
  const history = await listLoginEvents(id.data, lp)
  const liveSessionIds = new Set(d.sessions.map((s) => s.id))
  const m = adminMessages.admin.users
  const u = d.user
  return (
    <>
      <PageHeader
        title={u.username ?? `#${u.id}`}
        subtitle={`${u.email} · ${m.detail} #${u.id}${u.id === actor.id ? ` · ${adminMessages.admin.you}` : ''}`}
        actions={
          <div className="flex gap-1.5">
            <Pill tone="brand">{u.role}</Pill>
            {d.bans.some((b) => b.kind === 'user') ? <Pill tone="danger">{m.banned}</Pill> : null}
            {u.emailVerifiedAt ? <Pill tone="ok">{m.verified}</Pill> : <Pill>{m.unverified}</Pill>}
          </div>
        }
      />
      <div className="grid gap-3.5 xl:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-3.5">
          <UserActions
            user={{
              id: u.id,
              username: u.username,
              email: u.email,
              role: u.role,
              commentBannedUntil: u.commentBannedUntil?.toISOString() ?? null,
              emailVerifiedAt: u.emailVerifiedAt?.toISOString() ?? null,
            }}
            entitlements={d.entitlements.map((e) => ({
              ...e,
              expiresAt: e.expiresAt?.toISOString() ?? null,
            }))}
            sessions={d.sessions.map((s) => ({
              id: s.id,
              device: describeDevice(s.userAgent),
              createdAt: s.createdAt.toISOString(),
              lastSeenAt: s.lastSeenAt?.toISOString() ?? null,
            }))}
            bans={d.bans.map((b) => ({
              ...b,
              expiresAt: b.expiresAt?.toISOString() ?? null,
              createdAt: b.createdAt.toISOString(),
            }))}
            subscription={
              d.subscription
                ? {
                    ...d.subscription,
                    currentPeriodEnd: d.subscription.currentPeriodEnd.toISOString(),
                  }
                : null
            }
            perms={{
              role: can(actor, 'user.role'),
              grant: can(actor, 'entitlement.grant'),
              ban: can(actor, 'user.ban'),
              update: can(actor, 'user.update'),
            }}
            self={u.id === actor.id}
          />
          <LoginHistory
            rows={history.rows}
            page={lp}
            pages={history.pages}
            liveSessionIds={liveSessionIds}
            hrefFor={(n) => `/admin/users/${u.id}?lp=${n}`}
          />
        </div>
        <div className="flex flex-col gap-3.5">
          <Panel>
            <PanelHeader title={m.recentComments} />
            <ul className="flex flex-col gap-2 text-[13px]">
              {d.comments.length === 0 ? (
                <li className="text-fg-muted">{adminMessages.admin.none}</li>
              ) : null}
              {d.comments.map((c) => (
                <li key={c.id} className="border-b border-line-soft pb-2 last:border-0">
                  <div className="line-clamp-2">{c.text}</div>
                  <div className="text-[11px] text-fg-subtle">
                    {c.status} · {c.seriesTitle ?? ''} · <When date={c.createdAt} />
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel>
            <PanelHeader title={m.uploads} />
            <ul className="flex flex-col gap-1.5 text-[13px]">
              {d.uploads.length === 0 ? (
                <li className="text-fg-muted">{adminMessages.admin.none}</li>
              ) : null}
              {d.uploads.map((c) => (
                <li key={c.id} className="flex items-center gap-2">
                  <a
                    href={`/admin/series/${c.seriesId}?tab=chapters`}
                    className="font-semibold hover:text-brand-hover"
                  >
                    Ch. {formatChapterNumber(c.number)}
                  </a>
                  <span className="truncate text-fg-muted">{c.seriesTitle}</span>
                  <span className="ml-auto text-[11px] text-fg-subtle">{c.state}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel>
            <PanelHeader title={m.auditTrail} />
            <ul className="flex flex-col gap-1.5 text-[12px]">
              {d.trail.length === 0 ? (
                <li className="text-fg-muted">{adminMessages.admin.none}</li>
              ) : null}
              {d.trail.map((t) => (
                <li key={t.id} className="flex items-center gap-2">
                  <code className="rounded-sm bg-surface-3 px-1">{t.action}</code>
                  <span className="text-fg-muted">
                    {t.actor ?? adminMessages.admin.audit.system}
                  </span>
                  <span className="ml-auto text-fg-subtle">
                    <When date={t.createdAt} />
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  )
}
