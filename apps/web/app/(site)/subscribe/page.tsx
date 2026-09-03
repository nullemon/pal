import { fmt, messages } from '@palscans/core/messages'
import { getDb } from '@palscans/db'
import { Button } from '@palscans/ui'
import { Check, CircleAlert, Info, Lock, Zap } from 'lucide-react'
import type { Metadata } from 'next'
import type { ComponentType, ReactNode } from 'react'
import { getSessionUser } from '@/lib/auth'
import { accountBilling } from '@/lib/billing/account'
import { getBillingSettings } from '@/lib/billing/config'
import { billingConfigured } from '@/lib/billing/keys'
import { type BillingPlan, formatPrice, isSellable, listPlans } from '@/lib/billing/plans'
import { entitlementGate } from '@/lib/entitlements'
import { CheckoutButton } from './CheckoutButton'

const m = messages.premium
const b = messages.billing

export const metadata: Metadata = {
  title: `${m.title} · ${messages.site.name}`,
  description: m.pitch,
}

/** Personalised (current plan, verified email, live overrides), so never statically cached. */
export const dynamic = 'force-dynamic'

const featureLabel = (feature: string): string =>
  m.features[feature as keyof typeof m.features] ?? feature

function Notice({
  tone,
  icon: Icon,
  title,
  children,
}: {
  tone: 'warn' | 'brand'
  icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean | 'true'; className?: string }>
  title: string
  children?: ReactNode
}) {
  const tones =
    tone === 'warn' ? 'border-warn/40 bg-warn/10' : 'border-brand-dim bg-brand-wash text-fg'
  return (
    <div className={`mx-auto mt-8 flex max-w-[820px] gap-3 rounded-lg border p-4 ${tones}`}>
      <Icon size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-fg-muted" />
      <div className="flex flex-col gap-1">
        <p className="text-[14px] font-semibold text-fg">{title}</p>
        {children ? <p className="text-[13px] leading-5 text-fg-muted">{children}</p> : null}
      </div>
    </div>
  )
}

function PlanCard({
  plan,
  featured,
  cta,
  freeFeatures,
  currentPlanId,
}: {
  plan: BillingPlan
  featured: boolean
  cta: ReactNode
  freeFeatures: ReadonlySet<string>
  currentPlanId: string | null
}) {
  const isCurrent = currentPlanId === plan.id
  return (
    <section
      className={`flex flex-col gap-5 rounded-lg border p-6 ${
        featured ? 'border-brand bg-surface-2' : 'border-line bg-surface-1'
      }`}
    >
      <div>
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-[20px] font-extrabold uppercase text-fg">{plan.name}</h2>
          {isCurrent ? (
            <span className="rounded-full bg-brand-wash px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em] text-brand-hover">
              {b.currentPlan}
            </span>
          ) : null}
        </div>
        <p className="mt-2 flex items-baseline gap-1 text-fg">
          <span className="text-[32px] font-extrabold leading-none">
            {formatPrice(plan.priceCents)}
          </span>
          <span className="text-[13px] text-fg-muted">
            {plan.interval === 'year' ? '/ year' : m.perMonth}
          </span>
        </p>
      </div>
      <ul className="flex flex-col gap-2 text-[14px] text-fg">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <Check size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-ok" />
            <span>{featureLabel(f)}</span>
            {freeFeatures.has(f) ? (
              <span className="mt-0.5 whitespace-nowrap rounded-full bg-ok/15 px-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-ok">
                {m.freeForEveryone}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {cta}
    </section>
  )
}

/**
 * `/subscribe` — the plans page every "Premium" link and the reader's locked-chapter gate point
 * at (docs/07). Checkout is Stripe's hosted page; with no keys configured the plans still
 * render, clearly marked as not for sale, and no route is called (docs/17 §A).
 */
export default async function SubscribePage() {
  const db = await getDb()
  const [user, plans, settings, gate] = await Promise.all([
    getSessionUser(),
    listPlans(db),
    getBillingSettings(db),
    entitlementGate(),
  ])
  const configured = await billingConfigured()
  const account = user ? await accountBilling(db, user.id) : null
  const currentPlanId =
    account?.subscription &&
    ['active', 'trialing', 'past_due'].includes(account.subscription.status)
      ? account.subscription.planId
      : null
  // A tier taken off sale stays visible to the reader who is still on it.
  const visible = plans.filter((p) => p.active || p.id === currentPlanId)
  const freeFeatures = new Set(
    [...new Set(visible.flatMap((p) => p.features))].filter((f) => gate.isFree(f)),
  )

  const ctaFor = (plan: BillingPlan, featured: boolean) => {
    const variant = featured ? 'primary' : 'outline'
    if (!configured || !isSellable(plan))
      return (
        <Button size="lg" variant="outline" className="mt-auto" disabled>
          {b.planUnavailable}
        </Button>
      )
    if (!user)
      return (
        <Button
          size="lg"
          variant={variant}
          className="mt-auto"
          href={`/login?return=${encodeURIComponent('/subscribe')}&gate=premium`}
        >
          {b.signInFirst}
        </Button>
      )
    if (!user.emailVerifiedAt)
      return (
        <Button size="lg" variant="outline" className="mt-auto" href="/me/settings">
          {b.verifyFirst}
        </Button>
      )
    if (currentPlanId === plan.id)
      return (
        <Button size="lg" variant="outline" className="mt-auto" href="/me/billing">
          {b.manage}
        </Button>
      )
    return <CheckoutButton planId={plan.id} label={m.subscribe} variant={variant} />
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-10 md:px-6 md:py-14">
      <header className="mx-auto max-w-[640px] text-center">
        <p className="inline-flex items-center gap-1.5 rounded-full bg-brand-wash px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-brand-hover">
          <Zap size={14} aria-hidden="true" />
          {m.premium}
        </p>
        <h1 className="mt-4 font-display text-[32px] font-extrabold uppercase leading-none tracking-[-0.01em] text-fg md:text-[40px]">
          {m.title}
        </h1>
        <p className="mt-3 text-[16px] leading-6 text-fg-muted">{m.pitch}</p>
      </header>

      {configured ? null : (
        <Notice tone="warn" icon={CircleAlert} title={b.notConfigured}>
          {b.notConfiguredLead}
        </Notice>
      )}

      {gate.promotionActive ? (
        <Notice tone="brand" icon={Zap} title={m.allFreeTitle}>
          {m.allFreeLead}
        </Notice>
      ) : freeFeatures.size > 0 ? (
        <Notice tone="brand" icon={Zap} title={fmt(m.someFreeLead, { n: freeFeatures.size })}>
          {m.freeNote}
        </Notice>
      ) : null}

      <div className="mx-auto mt-10 grid max-w-[820px] gap-4 md:grid-cols-2">
        {visible.map((plan, i) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            featured={i === visible.length - 1}
            freeFeatures={freeFeatures}
            currentPlanId={currentPlanId}
            cta={ctaFor(plan, i === visible.length - 1)}
          />
        ))}
      </div>

      <ul className="mx-auto mt-8 flex max-w-[820px] flex-col gap-2 text-[13px] text-fg-subtle">
        <li className="flex items-start gap-2">
          <Lock size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          {b.securityNote}
        </li>
        <li className="flex items-start gap-2">
          <Info size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          {b.cancelAnytime}
        </li>
        {settings.taxEnabled ? (
          <li className="flex items-start gap-2">
            <Info size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
            {b.taxNote}
          </li>
        ) : null}
        {settings.statementDescriptor ? (
          <li className="flex items-start gap-2">
            <Info size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
            {fmt(b.statementNote, { descriptor: settings.statementDescriptor })}
          </li>
        ) : null}
      </ul>

      {gate.isFree('no_ads') ? null : (
        <p className="mx-auto mt-6 max-w-[640px] text-center text-[13px] text-fg-subtle">
          {m.adBlockNote}
        </p>
      )}
    </div>
  )
}
