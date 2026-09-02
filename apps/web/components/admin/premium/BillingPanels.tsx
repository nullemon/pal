import { messages } from '@palscans/core/messages'
import { CheckCircle2, CircleAlert, ExternalLink } from 'lucide-react'
import { formatPrice } from '@/lib/billing/plans'
import { Eyebrow, Hint, Panel, PanelHeader, Pill, StatTile, Table, Td, Th, When } from '../ui'
import { BillingSettingsForm } from './BillingSettingsForm'
import { type BillingAdminData, loadBillingAdmin } from './billing-data'

/**
 * Admin → Business → Premium, billing half (agent A · docs/17 §A). Composed into the Premium
 * screen next to agent B's entitlement overrides; every panel here is exported so the page can
 * arrange them differently without this file knowing about the page.
 */

const m = messages.billing.admin

function KeyRow({ label, present }: { label: string; present: boolean }) {
  return (
    <li className="flex items-center justify-between gap-3 border-b border-line-soft py-2 last:border-b-0">
      <span className="font-mono text-[12px] text-fg">{label}</span>
      <Pill tone={present ? 'ok' : 'warn'}>{present ? m.present : m.missing}</Pill>
    </li>
  )
}

/** Keys, the endpoint to register, and the event list the reducer acts on. */
export function BillingConnectionPanel({ data }: { data: BillingAdminData }) {
  const { keys } = data
  return (
    <Panel>
      <PanelHeader
        title={m.keysTitle}
        hint={m.keysHint}
        aside={
          keys.configured ? (
            <span className="inline-flex items-center gap-1.5 text-ok">
              <CheckCircle2 size={14} aria-hidden="true" />
              {m.ready}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-warn">
              <CircleAlert size={14} aria-hidden="true" />
              {messages.billing.notConfigured}
            </span>
          )
        }
      />
      {keys.configured ? null : (
        <p className="mb-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[13px] leading-5 text-fg">
          {messages.billing.notConfiguredLead} {messages.billing.notConfiguredAdmin}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <ul className="flex flex-col">
          <KeyRow label={m.secretKey} present={keys.secretKey} />
          <KeyRow label={m.webhookSecret} present={keys.webhookSecret} />
        </ul>
        <div className="flex flex-col gap-1.5">
          <Eyebrow>{m.webhookUrl}</Eyebrow>
          <code className="block overflow-x-auto rounded-md border border-line bg-bg px-3 py-2 font-mono text-[12px] text-fg">
            {data.webhookUrl}
          </code>
          <Hint>{m.webhookUrlHint}</Hint>
        </div>
      </div>
      <div className="mt-4">
        <Eyebrow>{m.eventsTitle}</Eyebrow>
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {data.handledEvents.map((e) => (
            <li
              key={e}
              className="rounded-full border border-line bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-fg-muted"
            >
              {e}
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  )
}

/** Subscriber counts, MRR and the open billing tickets a dispute leaves behind. */
export function BillingStatsPanel({ data }: { data: BillingAdminData }) {
  const { stats } = data
  return (
    <section className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-col gap-0.5">
          <h3 className="font-body text-[14px] font-bold leading-5">{m.subscribersTitle}</h3>
          <Hint>{m.subscribersHint}</Hint>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label={m.activeSubs} value={stats.active + stats.trialing} />
          <StatTile
            label={m.pastDueSubs}
            value={stats.pastDue}
            tone={stats.pastDue > 0 ? 'warn' : undefined}
          />
          <StatTile label={m.canceledSubs} value={stats.canceled} />
          <StatTile label={m.mrr} value={formatPrice(stats.mrrCents)} />
        </div>
      </div>
      <Panel>
        <PanelHeader title={m.openTickets} hint={m.openTicketsHint} />
        <div className="flex items-center justify-between gap-3">
          <span
            className={`font-body text-[26px] font-bold leading-8 tabular-nums ${
              data.openTickets > 0 ? 'text-danger' : ''
            }`}
          >
            {data.openTickets}
          </span>
          <a
            href="/admin/reports?status=open"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line px-3 text-[13px] hover:bg-surface-2"
          >
            {m.viewTickets}
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        </div>
      </Panel>
    </section>
  )
}

/** The last ten Stripe deliveries: processed rows wrote entitlements, pending ones did not. */
export function BillingEventsPanel({ data }: { data: BillingAdminData }) {
  return (
    <Panel className="p-0 md:px-0">
      <div className="p-4 pb-0 md:px-5">
        <PanelHeader title={m.webhookTitle} hint={m.webhookHint} />
      </div>
      <Table className="rounded-none border-0">
        <thead>
          <tr>
            <Th>{m.eventType}</Th>
            <Th>{m.received}</Th>
            <Th>{m.processed}</Th>
          </tr>
        </thead>
        <tbody>
          {data.events.length === 0 ? (
            <tr>
              <td colSpan={3} className="h-20 text-center text-[13px] text-fg-muted">
                {m.noEvents}
              </td>
            </tr>
          ) : (
            data.events.map((e) => (
              <tr key={e.id}>
                <Td>
                  <div className="font-mono text-[12px] text-fg">{e.type}</div>
                  <div className="font-mono text-[11px] text-fg-subtle">{e.id}</div>
                </Td>
                <Td className="text-fg-muted">
                  <When date={e.receivedAt} />
                </Td>
                <Td>
                  {e.processedAt ? (
                    <When date={e.processedAt} className="text-fg-muted" />
                  ) : (
                    <Pill tone="warn">{m.pending}</Pill>
                  )}
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
    </Panel>
  )
}

/** Everything agent A owns on the Premium screen, in one drop-in. */
export async function BillingPanels() {
  const data = await loadBillingAdmin()
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-body text-[16px] font-bold leading-[22px]">{m.title}</h2>
        <Hint>{m.subtitle}</Hint>
      </div>
      <BillingConnectionPanel data={data} />
      <BillingStatsPanel data={data} />
      <BillingSettingsForm
        settings={data.settings}
        plans={data.plans.map((p) => ({
          id: p.id,
          name: p.name,
          priceCents: p.priceCents,
          interval: p.interval === 'year' ? 'year' : 'month',
          stripePriceId: p.stripePriceId,
          features: [...p.features],
          active: p.active,
        }))}
      />
      <BillingEventsPanel data={data} />
    </div>
  )
}
