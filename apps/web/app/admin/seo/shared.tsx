'use client'

import { cn } from '@palscans/ui'
import type { ReactNode } from 'react'
import { Toggle } from '@/components/admin/client/controls'
import type { SitemapBuildView } from '@/lib/seo/admin-data'
import type { SeoSettings } from '@/lib/seo/settings'
import type { IndexNowLog } from '@/lib/seo/sitemaps'

/** Serialisable props for the SEO screen's client islands. */
export interface RedirectView {
  id: number
  from: string
  to: string
  status: number
  hits: number
  createdAt: string
}

export interface SeoAdminInitial {
  settings: SeoSettings
  builds: SitemapBuildView[]
  indexNow: IndexNowLog | null
  series: { id: number; slug: string; title: string }[]
  redirects: RedirectView[]
  origin: string
}

/** A labelled switch row: label + hint on the left, the toggle on the right. */
export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
  className,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (next: boolean) => void
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 border-b border-line-soft py-3 last:border-b-0',
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[13.5px] font-semibold text-fg">{label}</span>
        {hint ? <span className="text-[12.5px] leading-[17px] text-fg-muted">{hint}</span> : null}
      </div>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </div>
  )
}

export function FormGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid gap-4 md:grid-cols-2', className)}>{children}</div>
}

export const numberValue = (raw: string, fallback: number): number => {
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : fallback
}

export const bytes = (n: number): string =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`

export function Iso({ value }: { value: string | null }) {
  if (!value) return <span className="text-fg-subtle">—</span>
  return (
    <time dateTime={value} className="tabular-nums">
      {value.slice(0, 16).replace('T', ' ')}
    </time>
  )
}
