import { messages } from '@palscans/core/messages'
import { Check, Zap } from 'lucide-react'
import type { ReactNode } from 'react'

/** Title + lead; with `gate="premium"` the Premium pitch replaces them (deep link from a locked chapter). */
export function AuthHeading({ title, lead, gate }: { title: string; lead: string; gate?: string }) {
  if (gate === 'premium') {
    return (
      <div className="mb-8">
        <span className="inline-flex items-center gap-1.5 rounded-sm bg-brand-wash px-2 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-brand-hover">
          <Zap size={12} aria-hidden="true" />
          {messages.nav.premium}
        </span>
        <h1 className="mt-3 font-display text-[28px] font-extrabold uppercase leading-[1.05] tracking-[-0.02em] text-fg">
          {messages.authPage.premiumGateTitle}
        </h1>
        <p className="mt-2 text-sm text-fg-muted">{messages.authPage.premiumGateLead}</p>
        <ul className="mt-4 flex flex-col gap-1.5">
          {messages.authPage.premiumPerks.map((perk) => (
            <li key={perk} className="flex items-center gap-2 text-[13px] text-fg">
              <Check size={14} aria-hidden="true" className="text-ok" />
              {perk}
            </li>
          ))}
        </ul>
      </div>
    )
  }
  return (
    <div className="mb-8">
      <h1 className="font-display text-[28px] font-extrabold uppercase leading-[1.05] tracking-[-0.02em] text-fg">
        {title}
      </h1>
      <p className="mt-2 text-sm text-fg-muted">{lead}</p>
    </div>
  )
}

export function AuthFooterLink({ children }: { children: ReactNode }) {
  return <p className="mt-8 text-center text-[13px] text-fg-muted">{children}</p>
}
