'use client'

import { type ClockFormat, formatIsoDate, formatStamp } from '@palscans/core/formatting'
import { messages } from '@palscans/core/messages'
import { useEffect, useState } from 'react'
import { useFormatting } from './FormatContext'

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
  return formatIsoDate(d)
}

/**
 * The full stamp for `relativeTimes: 'absolute'` — "5 Sep 2026, 14:32", in the *reader's*
 * timezone, which is why it is only ever produced after hydration.
 */
export function formatAbsoluteStamp(iso: string, clock: ClockFormat): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return formatStamp(d, clock)
}

export interface RelativeTimeProps {
  /** ISO 8601 timestamp, rendered into `datetime` on the server. */
  iso: string
  className?: string
}

/**
 * Server renders `<time datetime>` with an absolute date so cached HTML is never wrong;
 * the client replaces the text with a relative phrase after hydration.
 *
 * Appearance → Formatting picks which of the three docs/15 shapes that is:
 *
 * - `both` (the default, and exactly what this component did before the setting existed) —
 *   the relative phrase, with the date on hover;
 * - `relative` — the phrase alone, no tooltip;
 * - `absolute` — the date *and* the time of day, written the way Formatting → Clock says.
 *
 * The first paint is `YYYY-MM-DD` in every mode. It has to be: the server does not know the
 * reader's timezone, and a stamp that disagreed between the two renders is a hydration
 * mismatch on every page of the site.
 */
export function RelativeTime({ iso, className }: RelativeTimeProps) {
  const { relativeTimes, clock } = useFormatting()
  const [label, setLabel] = useState<string>(() => formatAbsolute(iso))
  useEffect(() => {
    if (relativeTimes === 'absolute') {
      setLabel(formatAbsoluteStamp(iso, clock))
      return
    }
    setLabel(formatRelative(iso))
    const id = window.setInterval(() => setLabel(formatRelative(iso)), 60_000)
    return () => window.clearInterval(id)
  }, [iso, relativeTimes, clock])
  return (
    <time
      dateTime={iso}
      title={relativeTimes === 'both' ? formatAbsolute(iso) : undefined}
      className={className}
    >
      {label}
    </time>
  )
}
