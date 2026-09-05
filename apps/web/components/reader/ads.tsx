'use client'

import { fmt, messages } from '@palscans/core/messages'
import { AdSlot } from '@palscans/ui'
import type { ReaderAds } from './types'

/**
 * Desktop skyscrapers (docs/06, docs/11): one per gutter, sticky and vertically centred,
 * only when the viewport is wide enough that they never overlap the 820px column
 * (≥1280 for 160×600, ≥1520 for 300×600). Nothing is rendered without ads.
 */
export function Skyscrapers({ ads }: { ads: ReaderAds }) {
  if (!ads.enabled || !ads.skyscrapers) return null
  const { w, h } = ads.skySize
  const visible = w === 300 ? 'hidden min-[1520px]:block' : 'hidden xl:block'
  const offset = `calc((100vw - 820px) / 4 - ${w / 2}px)`
  const label = messages.readerUi.adSkyscraper
  return (
    <>
      <aside
        aria-label={messages.readerUi.adPage}
        className={`${visible} fixed top-1/2 z-20 -translate-y-1/2`}
        style={{ left: offset }}
      >
        <AdSlot
          slot="reader_sky_left"
          width={w}
          height={h}
          label={label}
          placeholder={ads.tags.sky === null}
          tag={ads.tags.sky}
        />
      </aside>
      <aside
        aria-label={messages.readerUi.adPage}
        className={`${visible} fixed top-1/2 z-20 -translate-y-1/2`}
        style={{ right: offset }}
      >
        <AdSlot
          slot="reader_sky_right"
          width={w}
          height={h}
          label={label}
          placeholder={ads.tags.sky === null}
          tag={ads.tags.sky}
        />
      </aside>
    </>
  )
}

/** The mobile in-strip band: a full-width dark band with a 300×250 centred, after every N pages. */
export function AdBand({ ads, n, className }: { ads: ReaderAds; n: number; className?: string }) {
  if (!ads.enabled || ads.mobileInterval === 0) return null
  return (
    <div
      data-ad-band={n}
      className={`flex w-full items-center justify-center bg-bg-deep p-6 ${className ?? ''}`}
    >
      <AdSlot
        slot="reader_instrip"
        width={300}
        height={250}
        label={fmt(messages.readerUi.adInStrip, { n: ads.mobileInterval })}
        placeholder={ads.tags.instrip === null}
        tag={ads.tags.instrip}
      />
    </div>
  )
}

/** End-of-chapter slot: 336×280 on desktop, 300×250 on mobile (docs/11). */
export function EndSlot({ ads, mobile }: { ads: ReaderAds; mobile: boolean }) {
  if (!ads.enabled || !ads.endSlot) return null
  return (
    <AdSlot
      slot="reader_end"
      width={mobile ? 300 : 336}
      height={mobile ? 250 : 280}
      label={messages.readerUi.adEndOfChapter}
      placeholder={ads.tags.end === null}
      tag={ads.tags.end}
    />
  )
}
