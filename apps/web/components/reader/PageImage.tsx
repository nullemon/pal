'use client'

import { fmt, messages } from '@palscans/core/messages'
import { useState } from 'react'
import { BlurHash } from './BlurHash'
import type { ReaderPage } from './types'

export interface PageImageProps {
  page: ReaderPage
  src: string
  alt: string
  /** First three pages: `eager` + `fetchpriority=high` (docs/06). */
  priority?: boolean
  /** False until the strip's IntersectionObserver brings the page within 150%. */
  load: boolean
  /** Page number ink for the corner counter; hidden when null. */
  counter?: string | null
  lightInk?: boolean
  className?: string
  style?: React.CSSProperties
  imgStyle?: React.CSSProperties
}

/**
 * One page: a box with the intrinsic aspect ratio reserved before any bytes arrive (zero
 * layout shift), a BlurHash under it, the `<img>` on top with real width/height.
 */
export function PageImage({
  page,
  src,
  alt,
  priority = false,
  load,
  counter,
  lightInk,
  className,
  style,
  imgStyle,
}: PageImageProps) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const active = load || priority
  return (
    <figure
      data-page={page.idx}
      className={`relative m-0 overflow-hidden bg-surface-1 ${className ?? ''}`}
      style={{ aspectRatio: `${page.width} / ${page.height}`, ...style }}
    >
      {page.blurHash && !loaded ? (
        <BlurHash hash={page.blurHash} className="absolute inset-0 size-full" />
      ) : null}
      {active && !failed ? (
        // biome-ignore lint/performance/noImgElement: pages are pre-encoded by the worker; the Next optimiser has nothing to add
        <img
          src={src}
          alt={alt}
          width={page.width}
          height={page.height}
          decoding="async"
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full select-none object-contain"
          style={imgStyle}
        />
      ) : null}
      {failed ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-fg-muted">
          <span>{fmt(messages.readerUi.pageFailed, { n: page.idx + 1 })}</span>
          <button
            type="button"
            className="min-h-11 rounded-md border border-line px-4 font-semibold text-fg"
            onClick={() => setFailed(false)}
          >
            {messages.readerUi.retryPage}
          </button>
        </div>
      ) : null}
      {counter ? (
        <figcaption
          className={`pointer-events-none absolute bottom-2 right-3 text-xs font-medium tabular-nums tracking-[0.02em] ${
            lightInk ? 'text-black/60' : 'text-fg-muted/75'
          }`}
        >
          {counter}
        </figcaption>
      ) : null}
    </figure>
  )
}
