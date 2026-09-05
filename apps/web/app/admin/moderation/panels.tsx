import { fmt } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import type {
  ModerationMetrics,
  ModeratorRow,
  QueueDepths,
  ReportAgeProfile,
  StaleItem,
  TimeToAction,
} from '@palscans/db'
import { cn } from '@palscans/ui'
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react'
import {
  EmptyRow,
  Hint,
  Num,
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
import {
  ageFill,
  duration,
  durationParts,
  type Severity,
  severityFor,
  sparkPath,
  stack,
} from './format'

/**
 * The panels of `/admin/moderation`. All server components except the flow chart — the
 * window is a link rather than client state, so the whole screen is one render and every
 * view of it is a URL someone can send.
 */

const m = adminMessages.queueHealth

const toneClass: Record<Severity, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
}
const pillTone: Record<Severity, PillTone> = { ok: 'ok', warn: 'warn', danger: 'danger' }

/**
 * The hero. Exactly one number on the screen is allowed to be this loud, and this is the one
 * that decides whether a moderation team is failing: how long the single oldest untouched
 * item has been waiting. Colour alone never carries it — the icon and the "Overdue" label
 * say the same thing for anyone who cannot see the red.
 */
export function OldestPanel({ stale }: { stale: StaleItem[] }) {
  const worst = stale[0]
  if (!worst) {
    return (
      <Panel className="border-ok/40">
        <div className="flex items-center gap-3">
          <CheckCircle2 size={22} className="shrink-0 text-ok" aria-hidden="true" />
          <div>
            <div className="font-body text-[19px] font-bold leading-6">{m.allClear}</div>
            <Hint>{m.allClearHint}</Hint>
          </div>
        </div>
      </Panel>
    )
  }
  const severity: Severity = worst.overdue ? severityFor(worst.ageMs, 24) : 'ok'
  const parts = durationParts(worst.ageMs)
  return (
    <Panel
      className={cn(
        severity === 'danger' && 'border-danger/50',
        severity === 'warn' && 'border-warn/50',
      )}
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          {severity === 'ok' ? (
            <Clock size={22} className="mt-2 shrink-0 text-fg-muted" aria-hidden="true" />
          ) : (
            <AlertTriangle
              size={22}
              className={cn('mt-2 shrink-0', toneClass[severity])}
              aria-hidden="true"
            />
          )}
          <div className="min-w-0">
            <div className="text-[12px] font-medium leading-4 text-fg-muted">{m.heroLead}</div>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span
                className={cn(
                  'font-body text-[52px] font-bold leading-[58px] tabular-nums tracking-[-0.02em]',
                  toneClass[severity],
                )}
              >
                {parts.value}
              </span>
              <span className="text-[16px] font-semibold text-fg-muted">{parts.unit}</span>
              {worst.overdue ? <Pill tone={pillTone[severity]}>{m.overdue}</Pill> : null}
            </div>
            <div className="mt-1 text-[13.5px] leading-5">
              <a href={worst.href} className="font-semibold hover:text-brand-hover">
                {worst.title}
              </a>
              <span className="text-fg-muted"> · {worst.detail}</span>
            </div>
            <Hint className="mt-0.5">{m.heroHint}</Hint>
          </div>
        </div>
        <StaleList stale={stale.slice(1)} />
      </div>
    </Panel>
  )
}

function StaleList({ stale }: { stale: StaleItem[] }) {
  if (stale.length === 0) return null
  return (
    <div className="w-full lg:max-w-[540px]">
      <div className="mb-1.5 text-[12px] font-semibold uppercase leading-4 tracking-[0.06em] text-fg-muted">
        {m.staleTitle}
      </div>
      <ul className="flex flex-col">
        {stale.map((item) => (
          <li
            key={`${item.queue}-${item.id}`}
            className="flex items-center justify-between gap-3 border-b border-line-soft py-1.5 text-[13px] last:border-0"
          >
            <a href={item.href} className="min-w-0 truncate hover:text-brand-hover">
              <span className="text-fg-subtle">{m.queues[item.queue]}</span>{' '}
              <span className="font-medium">#{item.id}</span>{' '}
              <span className="text-fg-muted">{item.detail}</span>
            </a>
            <span className="flex shrink-0 items-center gap-1.5">
              {item.overdue ? (
                <AlertTriangle size={12} className="text-danger" aria-hidden="true" />
              ) : null}
              <span
                className={cn(
                  'tabular-nums',
                  item.overdue ? 'font-semibold text-danger' : 'text-fg-muted',
                )}
                title={item.since.toISOString()}
              >
                {duration(item.ageMs)}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <Hint className="mt-1.5 text-[12px]">{m.staleHint}</Hint>
    </div>
  )
}

/** Queue depth as of now — deliberately above the window filter, which does not scope it. */
export function DepthRow({ depths }: { depths: QueueDepths }) {
  const tiles = [
    {
      label: m.openReports,
      hint: m.openReportsHint,
      value: depths.openReports,
      href: '/admin/reports?status=open',
      loud: true,
    },
    {
      label: m.triagedReports,
      hint: m.triagedReportsHint,
      value: depths.triagedReports,
      href: '/admin/reports?status=triaged',
      loud: false,
    },
    {
      label: m.commentsHeld,
      hint: m.commentsHeldHint,
      value: depths.commentsHeld,
      href: '/admin/comments?tab=pending',
      loud: true,
    },
    {
      label: m.reportedComments,
      hint: m.reportedCommentsHint,
      value: depths.reportedComments,
      href: '/admin/comments?tab=reported',
      loud: false,
    },
    {
      label: m.commentsShadow,
      hint: m.commentsShadowHint,
      value: depths.commentsShadow,
      href: '/admin/comments?tab=flagged',
      loud: false,
    },
    {
      label: m.takedownsUnacknowledged,
      hint: m.takedownsUnacknowledgedHint,
      value: depths.takedownsUnacknowledged,
      href: '/admin/takedowns?status=received',
      loud: true,
    },
    {
      label: m.takedownsOpen,
      hint: m.takedownsOpenHint,
      value: depths.takedownsOpen,
      href: '/admin/takedowns?status=open',
      loud: false,
    },
    {
      label: m.imagesPending,
      hint: m.imagesPendingHint,
      value: depths.imagesPending,
      href: '/admin/comments/images',
      loud: false,
    },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
      {tiles.map((t) => (
        <StatTile
          key={t.label}
          label={t.label}
          value={t.value}
          hint={t.hint}
          href={t.href}
          tone={t.loud && t.value > 0 ? 'warn' : undefined}
        />
      ))}
    </div>
  )
}

/**
 * The age distribution: one hue in three ordinal steps, because the bands are an ordered
 * scale and three unrelated hues would spend the identity channel on something the order
 * already says. The counts live in the key above the bar rather than inside the segments —
 * a label set on the darkest step could not clear contrast in both themes, and a number no
 * one can read is worse than no number.
 */
export function AgePanel({ ages }: { ages: ReportAgeProfile }) {
  const segments = stack(ages.bands, (b) => b.count)
  const stepOf = (key: string) => ages.bands.findIndex((b) => b.key === key)
  return (
    <Panel>
      <PanelHeader
        title={m.ageTitle}
        hint={m.ageHint}
        aside={
          <a href="/admin/reports?status=open" className="hover:text-brand-hover">
            {adminMessages.admin.reportsQueue.title}
          </a>
        }
      />
      {segments.length === 0 ? (
        <Hint>{m.ageEmpty}</Hint>
      ) : (
        <>
          <ul className="mb-2.5 flex flex-wrap gap-x-5 gap-y-1.5">
            {ages.bands.map((band, i) => (
              <li key={band.key} className="flex items-baseline gap-2 text-[13px]">
                <span
                  aria-hidden="true"
                  className="inline-block h-2.5 w-2.5 shrink-0 translate-y-px rounded-sm"
                  style={{ background: ageFill(i) }}
                />
                <span className="text-fg-muted">{m.bands[band.key]}</span>
                <Num
                  className={cn(
                    'font-bold',
                    band.key === 'stale' && band.count > 0 && 'text-danger',
                  )}
                >
                  {band.count}
                </Num>
                <span className="text-[12px] text-fg-subtle">
                  {ages.total > 0 ? `${Math.round((band.count / ages.total) * 100)}%` : ''}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex h-8 w-full gap-[2px]">
            {segments.map(({ item, percent }, i) => (
              <div
                key={item.key}
                style={{ width: `${percent}%`, background: ageFill(stepOf(item.key)) }}
                className={cn(
                  i === 0 && 'rounded-l-md',
                  i === segments.length - 1 && 'rounded-r-md',
                )}
                title={`${m.bands[item.key]}: ${item.count}`}
              />
            ))}
          </div>
          <Hint className="mt-2 text-[12px]">
            {m.bandTone.fresh} · {m.bandTone.aging} · {m.bandTone.stale}
          </Hint>
        </>
      )}
    </Panel>
  )
}

export function ByKindPanel({ ages }: { ages: ReportAgeProfile }) {
  return (
    <Panel className="p-0 md:px-0">
      <div className="px-5 pt-4">
        <PanelHeader title={m.byKindTitle} hint={m.byKindHint} />
      </div>
      <Table className="rounded-none border-0 border-t">
        <thead>
          <tr>
            <Th>{m.colKind}</Th>
            <Th align="right">{m.colOpen}</Th>
            <Th align="right">{m.colOldest}</Th>
          </tr>
        </thead>
        <tbody>
          {ages.byKind.length === 0 ? <EmptyRow colSpan={3}>{m.ageEmpty}</EmptyRow> : null}
          {ages.byKind.map((k) => {
            const severity = severityFor(k.oldestAgeMs, k.kind === 'dmca' ? 48 : 24)
            return (
              <tr key={k.kind}>
                <Td>
                  <a
                    href={`/admin/reports?status=open&kind=${encodeURIComponent(k.kind)}`}
                    className="font-semibold hover:text-brand-hover"
                  >
                    {k.kind}
                  </a>
                </Td>
                <Td align="right">
                  <Num>{k.open}</Num>
                </Td>
                <Td align="right">
                  <span className={cn('tabular-nums', toneClass[severity])}>
                    {duration(k.oldestAgeMs)}
                  </span>
                </Td>
              </tr>
            )
          })}
        </tbody>
      </Table>
    </Panel>
  )
}

function LatencyTiles({ tta, title, hint }: { tta: TimeToAction; title: string; hint: string }) {
  return (
    <Panel>
      <PanelHeader title={title} hint={hint} />
      {tta.handled === 0 ? (
        <Hint>{m.ttaEmpty}</Hint>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label={m.median} value={duration(tta.medianMs ?? 0)} hint={m.ttaMedianHint} />
          <StatTile label={m.p90} value={duration(tta.p90Ms ?? 0)} hint={m.ttaP90Hint} />
          <StatTile label={m.worst} value={duration(tta.worstMs ?? 0)} />
          <StatTile label={m.handled} value={tta.handled} hint={m.handledHint} />
        </div>
      )}
    </Panel>
  )
}

export function LatencyPanels({ metrics }: { metrics: ModerationMetrics }) {
  return (
    <div className="grid gap-3.5 xl:grid-cols-2">
      <LatencyTiles tta={metrics.reports} title={m.ttaTitle} hint={m.ttaHint} />
      <LatencyTiles tta={metrics.takedowns} title={m.ttaTakedownTitle} hint={m.slaTakedown} />
    </div>
  )
}

/**
 * Who is working. The per-person breakdown is the audit log in aggregate, so it follows the
 * audit log's own rule: an `audit.read` holder sees everyone, and everyone else sees their
 * own row. The queue numbers above are for whoever works the queue; a leaderboard is not.
 */
export function ModeratorsPanel({
  rows,
  full,
  viewerId,
  days,
}: {
  rows: ModeratorRow[]
  full: boolean
  viewerId: number
  days: number
}) {
  const visible = full ? rows : rows.filter((r) => r.actorId === viewerId)
  const max = Math.max(1, ...visible.map((x) => x.total))
  return (
    <Panel className="p-0 md:px-0">
      <div className="px-5 pt-4">
        <PanelHeader
          title={m.moderatorsTitle}
          hint={full ? m.moderatorsHint : m.moderatorsRestricted}
          aside={<span className="tabular-nums">{fmt(m.windowDays, { n: days })}</span>}
        />
      </div>
      <Table className="rounded-none border-0 border-t">
        <thead>
          <tr>
            <Th>{m.colModerator}</Th>
            <Th align="right">{m.colTotal}</Th>
            <Th>{m.colTrend}</Th>
            <Th align="right">{m.colReports}</Th>
            <Th align="right">{m.colComments}</Th>
            <Th align="right">{m.colUsers}</Th>
            <Th align="right">{m.colTakedowns}</Th>
            <Th align="right">{m.colLastAction}</Th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? <EmptyRow colSpan={8}>{m.moderatorsEmpty}</EmptyRow> : null}
          {visible.map((r) => (
            <tr key={r.actorId ?? 'system'}>
              <Td>
                {r.actorId ? (
                  <a
                    href={`/admin/users/${r.actorId}`}
                    className="font-semibold hover:text-brand-hover"
                  >
                    {r.username ?? `#${r.actorId}`}
                  </a>
                ) : (
                  <span className="text-fg-subtle">{m.system}</span>
                )}
                {r.actorId === viewerId ? (
                  <span className="ml-1.5 text-[12px] text-fg-subtle">({m.you})</span>
                ) : null}
                {r.role ? <span className="ml-2 text-[12px] text-fg-subtle">{r.role}</span> : null}
              </Td>
              <Td align="right">
                <span className="flex items-center justify-end gap-2">
                  <span className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-3">
                    <span
                      className="block h-full rounded-full bg-brand-hover"
                      style={{ width: `${Math.round((r.total / max) * 100)}%` }}
                    />
                  </span>
                  <Num className="font-semibold">{r.total}</Num>
                </span>
              </Td>
              <Td>
                <svg
                  width={90}
                  height={18}
                  viewBox="0 0 90 18"
                  aria-hidden="true"
                  className="block"
                >
                  <path
                    d={sparkPath(r.perDay, 90, 18)}
                    fill="none"
                    stroke="var(--color-brand-hover)"
                    strokeWidth={1.5}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                </svg>
              </Td>
              <Td align="right" className="text-fg-muted">
                <Num>{r.reports || '—'}</Num>
              </Td>
              <Td align="right" className="text-fg-muted">
                <Num>{r.comments || '—'}</Num>
              </Td>
              <Td align="right" className="text-fg-muted">
                <Num>{r.users || '—'}</Num>
              </Td>
              <Td align="right" className="text-fg-muted">
                <Num>{r.takedowns || '—'}</Num>
              </Td>
              <Td align="right" className="text-fg-muted">
                <When date={r.lastActionAt} />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Panel>
  )
}
