import type { ReactNode } from 'react'

/** A titled card on the account pages. */
export function Section({
  id,
  title,
  description,
  action,
  children,
}: {
  id?: string
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-24 rounded-lg border border-line bg-surface-1 p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-extrabold uppercase tracking-[-0.01em] text-fg">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 max-w-[60ch] text-[13px] text-fg-muted">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function PageTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <h1 className="font-display text-2xl font-extrabold uppercase tracking-[-0.02em] text-fg">
        {title}
      </h1>
      {children}
    </div>
  )
}
