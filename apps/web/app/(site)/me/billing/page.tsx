import { isStaff, rowActive } from '@palscans/core'
import { fmt, messages } from '@palscans/core/messages'
import { getDb } from '@palscans/db'
import { Button } from '@palscans/ui'
import { CircleAlert, FileText, LifeBuoy, Zap } from 'lucide-react'
import type { Metadata } from 'next'
import { type AccountSubscription, accountBilling } from '@/lib/billing/account'
import { getBillingSettings } from '@/lib/billing/config'
import { formatPrice } from '@/lib/billing/plans'
import { entitlementGate } from '@/lib/entitlements'
import { billingConfigured } from '@/lib/env'
import { PageTitle, Section } from '../_components/Section'
import { requireAccount } from '../_lib'
import { PortalButton } from './PortalButton'

export const metadata: Metadata = { title: messages.me.billing.title }

const b = messages.billing
const me = messages.me.billing

const day = (date: Date): string => date.toISOString().slice(0, 10)

const statusLabel = (status: string): string =>
  b.statuses[status as keyof typeof b.statuses] ?? status

const statusTone = (status: string): string => {
  if (status === 'active' || status === 'trialing') return 'bg-ok/15 text-ok'
  if (status === 'past_due' || status === 'unpaid') return 'bg-warn/15 text-warn'
  return 'bg-surface-3 text-fg-muted'
}

function PlanLine({ subscription }: { subscription: AccountSubscription }) {
  const ends = subscription.currentPeriodEnd
  const copy =
    subscription.status === 'canceled' || subscription.cancelAtPeriodEnd
      ? fmt(subscription.status === 'canceled' ? b.endsOn : b.cancelsOn, { date: day(ends) })
      : fmt(b.renewsOn, { date: day(ends) })
  return (
    <p className="mt-1 text-[13px] text-fg-muted">
      {formatPrice(subscription.priceCents)}
      {subscription.interval === 'year' ? ' / year' : ' / month'} ·{' '}
      <time dateTime={ends.toISOString()}>{copy}</time>
    </p>
  )
}

/**
 * `/me/billing` — the plan, the perks it granted, and every receipt (docs/07: "receipts linked
 * from /me/billing"). Cancelling and changing the card happen in Stripe's portal; with billing
 * unconfigured this page still renders, saying so, and calls nothing.
 */
export default async function BillingPage() {
  const user = await requireAccount('/me/billing')
  const db = await getDb()
  const [account, settings, gate] = await Promise.all([
    accountBilling(db, user.id),
    getBillingSettings(db),
    entitlementGate(),
  ])
  const configured = billingConfigured()
  const sub = account.subscription
  const rows = user.entitlements ?? []
  const features = [...new Set(rows.filter((r) => rowActive(r)).map((r) => r.feature))]
  const canPortal = configured && settings.portalEnabled && account.hasCustomer

  return (
    <>
      <PageTitle title={me.title} />
      <div className="flex flex-col gap-6">
        {account.hasOpenTicket ? (
          <div className="flex gap-3 rounded-lg border border-danger/40 bg-danger/10 p-4">
            <CircleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
            <div>
              <p className="text-[14px] font-semibold text-fg">{b.help}</p>
              <p className="mt-1 text-[13px] leading-5 text-fg-muted">{b.helpLead}</p>
            </div>
          </div>
        ) : null}

        {sub && sub.status === 'past_due' ? (
          <div className="flex gap-3 rounded-lg border border-warn/40 bg-warn/10 p-4">
            <CircleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-warn" />
            <div>
              <p className="text-[14px] font-semibold text-fg">{b.pastDueTitle}</p>
              <p className="mt-1 text-[13px] leading-5 text-fg-muted">
                {fmt(b.pastDueLead, { date: day(sub.currentPeriodEnd) })}
              </p>
            </div>
          </div>
        ) : null}

        <Section title={me.plan} description={configured ? b.cancelAnytime : b.notConfiguredLead}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="inline-flex items-center gap-2 font-display text-xl font-extrabold uppercase text-fg">
                <Zap size={18} aria-hidden="true" className="text-gold" />
                {sub ? sub.planName : isStaff(user) ? messages.premium.premium : me.free}
                {sub ? (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em] ${statusTone(sub.status)}`}
                  >
                    {statusLabel(sub.status)}
                  </span>
                ) : null}
              </p>
              {sub ? <PlanLine subscription={sub} /> : null}
            </div>
            <div className="flex items-center gap-2">
              {canPortal ? <PortalButton /> : null}
              <Button href="/subscribe" variant={sub ? 'outline' : 'primary'} size="sm">
                {me.upgrade}
              </Button>
            </div>
          </div>
          {canPortal ? <p className="mt-3 text-[12px] text-fg-subtle">{b.manageHint}</p> : null}
        </Section>

        <Section title={me.entitlements}>
          {features.length === 0 ? (
            <p className="text-[13px] text-fg-muted">{me.none}</p>
          ) : (
            <ul className="divide-y divide-line-soft rounded-md border border-line">
              {features.map((f) => {
                const row = rows.find((r) => r.feature === f && rowActive(r))
                return (
                  <li key={f} className="flex items-center justify-between gap-3 p-3 text-sm">
                    <span className="font-semibold text-fg">
                      {messages.premium.features[f as keyof typeof messages.premium.features] ?? f}
                      {gate.isFree(f) ? (
                        <span className="ml-2 rounded-full bg-ok/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-ok">
                          {messages.premium.freeForEveryone}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-[12px] text-fg-muted">
                      {row?.expires_at ? (
                        <time dateTime={row.expires_at.toISOString()}>
                          {fmt(me.until, { date: day(row.expires_at) })}
                        </time>
                      ) : (
                        me.permanent
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>

        <Section title={b.receipts} description={b.receiptsHint}>
          {account.receipts.length === 0 ? (
            <p className="text-[13px] text-fg-muted">{b.receiptsEmpty}</p>
          ) : (
            <ul className="divide-y divide-line-soft rounded-md border border-line">
              {account.receipts.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <FileText size={16} aria-hidden="true" className="shrink-0 text-fg-subtle" />
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-fg">
                        {r.description ?? r.stripeInvoiceId}
                      </p>
                      <p className="text-[12px] text-fg-muted">
                        <time dateTime={r.issuedAt.toISOString()}>{day(r.issuedAt)}</time> ·{' '}
                        {formatPrice(r.amountCents, r.currency)} ·{' '}
                        {b.receiptStatuses[r.status as keyof typeof b.receiptStatuses] ?? r.status}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {r.hostedInvoiceUrl ? (
                      <Button
                        href={r.hostedInvoiceUrl}
                        size="sm"
                        variant="outline"
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {b.receiptOpen}
                      </Button>
                    ) : null}
                    {r.invoicePdfUrl ? (
                      <Button
                        href={r.invoicePdfUrl}
                        size="sm"
                        variant="ghost"
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {b.receiptPdf}
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={b.help} description={b.helpLead}>
          <Button href={settings.supportPath} variant="outline" size="sm">
            <LifeBuoy size={15} aria-hidden="true" />
            {b.helpCta}
          </Button>
        </Section>
      </div>
    </>
  )
}
