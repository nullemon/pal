import type { ReactNode } from 'react'

/** One number with its label, on the reader's stats page. */
export function StatTile({
  label,
  value,
  hint,
}: {
  label: string
  value: ReactNode
  hint?: string
}) {
  return (
    <div className="rounded-lg border border-line bg-surface-1 p-4">
      <p className="font-display text-2xl font-extrabold tabular-nums leading-none text-fg">
        {value}
      </p>
      <p className="mt-2 text-[13px] font-semibold text-fg-muted">{label}</p>
      {hint ? <p className="mt-0.5 text-[12px] text-fg-subtle">{hint}</p> : null}
    </div>
  )
}
