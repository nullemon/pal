import { messages } from '@palscans/core/messages'
import { cn, RelativeTime } from '@palscans/ui'
import { CheckCircle2, TriangleAlert } from 'lucide-react'
import type { Metadata } from 'next'
import { type ComponentState, cachedStatus } from './_health'

/**
 * `/status` — the public uptime page (docs/17 §G, docs/13 "Status page").
 *
 * Three things this page must do, in order of how easy they are to get wrong:
 *
 *  1. **Render for a signed-out visitor.** No session is read and no account is required:
 *     the reader checking whether the site is broken is, by definition, having trouble.
 *  2. **Say the database is down without the database.** Nothing on the route reads from
 *     it — the only database call is the probe, and it is wrapped in a catch and a timeout.
 *     The layout above it is static, and the appearance query in the root layout already
 *     falls back to compiled defaults when the database is unreachable.
 *  2b. **Not become the outage.** The render is dynamic, but the probes behind it are
 *     memoised in process for `STATUS_TTL_MS` and shared by whatever arrives while a round
 *     is running (`cachedStatus`), so five live checks — one of them a billed round trip to
 *     R2 — are a cost per process per twelve seconds and not a cost per visitor. The page
 *     stays truthful because it prints when it was checked, not "now".
 *  3. **Leak nothing.** Two words per component and a timestamp. No hostname, driver,
 *     version, queue depth, error message or hint about what is configured.
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata: Metadata = {
  title: messages.status.title,
  description: messages.status.lead,
  robots: { index: false, follow: true },
}

/**
 * `ok` / `warn`, not the series-status colours: green and amber are what a status page is
 * read as at a glance, and the shape of the icon plus the word beside it carry the same
 * information for anyone who does not see the difference between them.
 */
const tone = (state: ComponentState) =>
  state === 'operational'
    ? { dot: 'bg-ok', text: 'text-ok' }
    : { dot: 'bg-warn', text: 'text-warn' }

export default async function StatusPage() {
  const snapshot = await cachedStatus()
  const m = messages.status
  const healthy = snapshot.overall === 'operational'

  return (
    <div className="container-page py-8 lg:py-10">
      <h1 className="font-display text-2xl font-extrabold uppercase tracking-[-0.02em] text-fg">
        {m.title}
      </h1>
      <p className="mt-2 max-w-[60ch] text-[13px] text-fg-muted">{m.lead}</p>

      <section
        aria-live="polite"
        className={cn(
          'mt-6 flex items-start gap-3 rounded-lg border bg-surface-1 p-4',
          healthy ? 'border-ok/40' : 'border-warn/50',
        )}
      >
        <span className={cn('mt-0.5', tone(snapshot.overall).text)}>
          {healthy ? (
            <CheckCircle2 size={20} aria-hidden="true" />
          ) : (
            <TriangleAlert size={20} aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0">
          <p className="font-display text-base font-extrabold uppercase tracking-[-0.01em] text-fg">
            {healthy ? m.allOperational : m.someDegraded}
          </p>
          {healthy ? null : (
            <p className="mt-1 max-w-[60ch] text-[13px] text-fg-muted">{m.degradedLead}</p>
          )}
          <p className="mt-1 text-[12px] text-fg-subtle">
            {m.checked} <RelativeTime iso={snapshot.checkedAt} />
          </p>
        </div>
      </section>

      <ul className="mt-4 divide-y divide-line-soft rounded-lg border border-line bg-surface-1">
        {snapshot.components.map((component) => (
          <li key={component.id} className="flex items-center gap-3 p-4">
            <span
              aria-hidden="true"
              className={cn('size-2.5 shrink-0 rounded-full', tone(component.state).dot)}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-fg">{m.components[component.id]}</p>
              <p className="mt-0.5 text-[12px] text-fg-muted">{m.componentHints[component.id]}</p>
            </div>
            <span
              className={cn(
                'shrink-0 text-[12px] font-bold uppercase tracking-[0.06em]',
                tone(component.state).text,
              )}
            >
              {component.state === 'operational' ? m.operational : m.degraded}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-[12px] text-fg-subtle">{m.legend}</p>
    </div>
  )
}
