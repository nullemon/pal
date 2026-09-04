'use client'

import { messages } from '@palscans/core/messages'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { countdownSeconds } from '@/lib/countdown'

/** "Free for everyone in {countdown}." around the live time, so word order stays translatable. */
const [BEFORE, AFTER] = messages.readerUi.lockedFreeIn.split('{countdown}')

/**
 * The countdown on the locked-chapter gate (docs/06 "Locked chapters").
 *
 * A client island rather than server text for two reasons the default ten-minute window makes
 * obvious: core's `countdown()` floors at "1m", so the last minute of the wait would read as
 * frozen; and a gate rendered once on the server would still say "1m" long after the chapter
 * opened. This counts in seconds and asks the route for a fresh render the moment the window
 * closes, so a reader who waits it out gets the chapter without touching anything.
 */
export function UnlockCountdown({ freeAt, now }: { freeAt: string; now: string }) {
  const router = useRouter()
  const until = new Date(freeAt).getTime()
  const [nowMs, setNowMs] = useState(() => new Date(now).getTime())
  const done = nowMs >= until

  useEffect(() => {
    setNowMs(Date.now())
    const id = window.setInterval(() => setNowMs(Date.now()), 1_000)
    return () => window.clearInterval(id)
  }, [])

  // Once the window has closed, ask the server again — and keep asking on a slow beat, in case
  // its clock runs a little behind ours. `refresh()` costs one render when nothing changed.
  useEffect(() => {
    if (!done) return
    const first = window.setTimeout(() => router.refresh(), 500)
    const retry = window.setInterval(() => router.refresh(), 5_000)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(retry)
    }
  }, [done, router])

  if (done) return <span>{messages.readerUi.lockedUnlocking}</span>
  return (
    <span>
      {BEFORE}
      <time dateTime={freeAt} className="font-semibold text-fg tabular-nums">
        {countdownSeconds(until, nowMs)}
      </time>
      {AFTER}
    </span>
  )
}
