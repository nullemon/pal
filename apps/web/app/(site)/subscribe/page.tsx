import { messages } from '@palscans/core/messages'
import { getDb, plans } from '@palscans/db'
import { Button } from '@palscans/ui'
import { asc } from 'drizzle-orm'
import { Check, Zap } from 'lucide-react'
import type { Metadata } from 'next'

export const revalidate = 300

const m = messages.premium

export const metadata: Metadata = {
  title: `${m.title} · ${messages.site.name}`,
  description: m.pitch,
}

const price = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)

/**
 * /subscribe — the Premium plans page every "Premium" / "Go Premium" link and the reader's
 * locked-chapter gate point at (docs/07). Checkout (Stripe) lands later; the call to action
 * goes to /me/billing, which asks for a sign-in first.
 */
export default async function SubscribePage() {
  const db = await getDb()
  const rows = await db.select().from(plans).orderBy(asc(plans.priceCents))
  const bullets = Object.values(m.bullets)

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

      <div className="mx-auto mt-10 grid max-w-[820px] gap-4 md:grid-cols-2">
        {rows.map((plan, i) => {
          const featured = i === rows.length - 1
          return (
            <section
              key={plan.id}
              className={`flex flex-col gap-5 rounded-lg border p-6 ${
                featured ? 'border-brand bg-surface-2' : 'border-line bg-surface-1'
              }`}
            >
              <div>
                <h2 className="font-display text-[20px] font-extrabold uppercase text-fg">
                  {plan.name}
                </h2>
                <p className="mt-2 flex items-baseline gap-1 text-fg">
                  <span className="text-[32px] font-extrabold leading-none">
                    {price(plan.priceCents)}
                  </span>
                  <span className="text-[13px] text-fg-muted">{m.perMonth}</span>
                </p>
              </div>
              <ul className="flex flex-col gap-2 text-[14px] text-fg">
                {bullets.slice(0, featured ? bullets.length : 2).map((b) => (
                  <li key={b} className="flex items-start gap-2">
                    <Check size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-ok" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <Button
                href="/me/billing"
                size="lg"
                variant={featured ? 'primary' : 'outline'}
                className="mt-auto"
              >
                {m.subscribe}
              </Button>
            </section>
          )
        })}
      </div>

      <p className="mx-auto mt-8 max-w-[640px] text-center text-[13px] text-fg-subtle">
        {m.adBlockNote}
      </p>
    </div>
  )
}
