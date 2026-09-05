'use client'

import { fmt, messages } from '@palscans/core/messages'
import { Rail, SeriesCard, type SeriesType } from '@palscans/ui'
import { Smartphone } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { localContinueReading, localProgressSupported } from './local'
import { mergeDeviceProgressOnce } from './merge'
import type { LocalProgress } from './types'

/**
 * The signed-out half of "do not lose my place", and the moment it stops being signed out.
 *
 * Everything here runs after mount, on purpose: what this browser remembers is not known on
 * the server, and pretending otherwise would either break hydration or leak a device's
 * reading into a cached HTML response.
 */

/**
 * The intrinsic cover size every card uses (docs/05). Repeated rather than imported from
 * `components/discovery/media`, which reaches into the server env to build CDN URLs and has
 * no business in a client bundle.
 */
const COVER_WIDTH = 400
const COVER_HEIGHT = 600

/** `novel` has no chip of its own on a card; the rest map straight through. */
const seriesType = (type: string): SeriesType =>
  type === 'manhwa' || type === 'manhua' || type === 'manga' ? type : 'comic'

/** A series with no stored cover: a transparent rect, so the card's own surface shows. */
const PLACEHOLDER_COVER = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${COVER_WIDTH}" height="${COVER_HEIGHT}"><rect width="100%" height="100%" fill="transparent"/></svg>`,
)}`

const cover = (row: LocalProgress) => ({
  src: row.coverSrc ?? PLACEHOLDER_COVER,
  width: COVER_WIDTH,
  height: COVER_HEIGHT,
  alt: fmt(messages.discovery.coverAlt, { title: row.seriesTitle }),
})

/**
 * "Saved on this device". Every surface that shows local progress carries it — a reader who
 * believes their place is on an account and then clears their browser loses everything and
 * has no way to know why.
 */
export function DeviceOnlyNote({ signInHref }: { signInHref?: string }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-fg-subtle">
      <Smartphone size={13} aria-hidden="true" />
      <span>{messages.localProgress.deviceOnly}</span>
      <span className="opacity-50">·</span>
      <span>{messages.localProgress.deviceOnlyHint}</span>
      {signInHref ? (
        <Link href={signInHref} className="font-semibold text-brand-hover hover:underline">
          {messages.localProgress.signIn}
        </Link>
      ) : null}
    </p>
  )
}

/**
 * The home page's "Continue reading" for a reader with no account. Renders nothing at all
 * until it has found something — a first-time visitor sees the page they would have seen
 * anyway, with no reserved empty space and no layout shift.
 */
export function DeviceContinueReading({ limit = 12 }: { limit?: number }) {
  const [rows, setRows] = useState<LocalProgress[] | null>(null)

  useEffect(() => {
    let live = true
    void localContinueReading(limit).then((r) => {
      if (live) setRows(r)
    })
    return () => {
      live = false
    }
  }, [limit])

  if (!rows || rows.length === 0) return null
  return (
    <section aria-labelledby="device-continue-title" className="flex flex-col gap-2">
      <h2
        id="device-continue-title"
        className="section-title flex items-center gap-2 text-[18px] leading-[22px]"
      >
        {messages.localProgress.continueTitle}
      </h2>
      <Rail label={messages.localProgress.continueTitle} itemWidth="140px">
        {rows.map((row) => (
          <SeriesCard
            key={row.chapterId}
            title={row.seriesTitle}
            href={row.seriesHref}
            cover={cover(row)}
            type={seriesType(row.seriesType)}
            latestChapter={{
              number: fmt(messages.series.continueChapter, {
                chapter: fmt(messages.series.chapterShort, { n: row.chapterNumber }),
              }),
              href: row.chapterHref,
            }}
          />
        ))}
      </Rail>
      <DeviceOnlyNote signInHref="/login?return=%2F" />
    </section>
  )
}

/**
 * Hands this browser's reading to the account the reader just signed into. Mounted wherever
 * a reader plausibly lands after signing in — the home page and the reader itself — and a
 * no-op every time after the first, so the common case costs one localStorage read.
 */
export function MergeDeviceProgress({ userId }: { userId: number }) {
  useEffect(() => {
    void mergeDeviceProgressOnce(userId)
  }, [userId])
  return null
}

/** Shown at the top of `/me/history` for a signed-out reader, when nothing can be stored. */
export function DeviceStorageWarning() {
  const [blocked, setBlocked] = useState(false)
  useEffect(() => {
    setBlocked(!localProgressSupported())
  }, [])
  if (!blocked) return null
  return (
    <p className="rounded-lg border border-line bg-surface-1 p-3 text-[13px] text-fg-muted">
      {messages.localProgress.unavailable}
    </p>
  )
}
