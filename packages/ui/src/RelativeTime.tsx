'use client'

import { messages } from '@palscans/core/messages'
import { useEffect, useState } from 'react'

const DIVISIONS: Array<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { amount: 60, unit: 'second' },
  { amount: 60, unit: 'minute' },
  { amount: 24, unit: 'hour' },
  { amount: 7, unit: 'day' },
  { amount: 4.34524, unit: 'week' },
  { amount: 12, unit: 'month' },
  { amount: Number.POSITIVE_INFINITY, unit: 'year' },
]

/** "12 min ago" style. Exported so tests and other components can reuse it. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  let duration = (then - now.getTime()) / 1000
  if (Math.abs(duration) < 45) return messages.time.justNow
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'always', style: 'narrow' })
  for (const division of DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return rtf.format(Math.round(duration), division.unit)
    }
    duration /= division.amount
  }
  return iso
}

export function formatAbsolute(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toISOString().slice(0, 10)
}

export interface RelativeTimeProps {
  /** ISO 8601 timestamp, rendered into `datetime` on the server. */
  iso: string
  className?: string
}

/**
 * Server renders `<time datetime>` with an absolute date so cached HTML is never wrong;
 * the client replaces the text with a relative phrase after hydration.
 */
export function RelativeTime({ iso, className }: RelativeTimeProps) {
  const [label, setLabel] = useState<string>(() => formatAbsolute(iso))
  useEffect(() => {
    setLabel(formatRelative(iso))
    const id = window.setInterval(() => setLabel(formatRelative(iso)), 60_000)
    return () => window.clearInterval(id)
  }, [iso])
  return (
    <time dateTime={iso} title={formatAbsolute(iso)} className={className}>
      {label}
    </time>
  )
}
