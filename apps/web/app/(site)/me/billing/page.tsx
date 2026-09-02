import { activeFeatures, type FEATURES, isStaff, rowActive } from '@palscans/core'
import { fmt, messages } from '@palscans/core/messages'
import { getDb, plans, subscriptions } from '@palscans/db'
import { Button } from '@palscans/ui'
import { and, eq, inArray } from 'drizzle-orm'
import { Zap } from 'lucide-react'
import type { Metadata } from 'next'
import { PageTitle, Section } from '../_components/Section'
import { requireAccount } from '../_lib'

export const metadata: Metadata = { title: messages.me.billing.title }

const featureLabel: Record<(typeof FEATURES)[number], string> = {
  early_access: messages.premium.bullets.earlyAccess,
  premium_content: messages.series.premiumOnly,
  no_ads: messages.premium.bullets.adFree,
  offline: messages.premium.bullets.offline,
}

/** Billing placeholder: the plan from `subscriptions`, perks from `entitlements` (docs/07). Stripe lands later. */
export default async function BillingPage() {
  const user = await requireAccount('/me/billing')
  const db = await getDb()
  const [sub] = await db
    .select({
      plan: plans.name,
      status: subscriptions.status,
      periodEnd: subscriptions.currentPeriodEnd,
      cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(
      and(
        eq(subscriptions.userId, user.id),
        inArray(subscriptions.status, ['active', 'trialing', 'past_due']),
      ),
    )
    .limit(1)
  const features = activeFeatures(user)
  const rows = user.entitlements ?? []

  return (
    <>
      <PageTitle title={messages.me.billing.title} />
      <div className="flex flex-col gap-6">
        <Section title={messages.me.billing.plan} description={messages.me.billing.lead}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="inline-flex items-center gap-2 font-display text-xl font-extrabold uppercase text-fg">
              <Zap size={18} aria-hidden="true" className="text-gold" />
              {sub ? sub.plan : isStaff(user) ? messages.premium.premium : messages.me.billing.free}
              {sub ? (
                <span className="text-[12px] font-semibold normal-case text-fg-muted">
                  {fmt(messages.me.billing.until, {
                    date: sub.periodEnd.toISOString().slice(0, 10),
                  })}
                </span>
              ) : null}
            </p>
            <Button href="/subscribe" variant={sub ? 'outline' : 'primary'} size="sm">
              {sub ? messages.me.billing.manage : messages.me.billing.upgrade}
            </Button>
          </div>
        </Section>
        <Section title={messages.me.billing.entitlements}>
          {features.length === 0 ? (
            <p className="text-[13px] text-fg-muted">{messages.me.billing.none}</p>
          ) : (
            <ul className="divide-y divide-line-soft rounded-md border border-line">
              {features.map((f) => {
                const row = rows.find((r) => r.feature === f && rowActive(r))
                return (
                  <li key={f} className="flex items-center justify-between gap-3 p-3 text-sm">
                    <span className="font-semibold text-fg">{featureLabel[f]}</span>
                    <span className="text-[12px] text-fg-muted">
                      {row?.expires_at ? (
                        <>
                          {fmt(messages.me.billing.until, { date: '' })}
                          <time dateTime={row.expires_at.toISOString()}>
                            {row.expires_at.toISOString().slice(0, 10)}
                          </time>
                        </>
                      ) : (
                        messages.me.billing.permanent
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>
      </div>
    </>
  )
}
