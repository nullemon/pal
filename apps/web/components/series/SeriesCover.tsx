'use client'

import { messages } from '@palscans/core/messages'
import { X } from 'lucide-react'
import { useRef } from 'react'

export interface SeriesCoverProps {
  src: string | null
  alt: string
  /** Dominant cover colour for the placeholder wash. */
  color?: string | null
  className?: string
}

/** The cover card with a lightbox (docs/06 "cover with lightbox"). The image is the LCP: eager + high priority. */
export function SeriesCover({ src, alt, color, className }: SeriesCoverProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const img = src ? (
    <img
      src={src}
      alt={alt}
      width={300}
      height={450}
      fetchPriority="high"
      decoding="async"
      className="block aspect-[2/3] h-auto w-full rounded-[10px] object-cover shadow-2 ring-1 ring-fg/5"
    />
  ) : (
    <span
      aria-label={alt}
      role="img"
      className="block aspect-[2/3] w-full rounded-[10px] bg-surface-3"
      style={
        color
          ? { background: `linear-gradient(160deg, ${color}, var(--color-surface-2))` }
          : undefined
      }
    />
  )
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        aria-label={messages.seriesDetail.lightbox}
        className="block w-full rounded-[16px] border border-line bg-surface-1 p-2.5 text-left focus-visible:outline-2 focus-visible:outline-brand"
      >
        {img}
      </button>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the native dialog closes on Escape; the click only handles the backdrop */}
      <dialog
        ref={ref}
        onClick={(e) => {
          if (e.target === ref.current) ref.current?.close()
        }}
        className="m-auto max-h-[92dvh] w-auto max-w-[min(92vw,640px)] rounded-lg border border-line bg-surface-1 p-2 backdrop:bg-bg/85 backdrop:backdrop-blur-sm"
      >
        {src ? (
          <img
            src={src}
            alt={alt}
            width={600}
            height={900}
            className="block h-auto max-h-[85dvh] w-auto rounded-md"
          />
        ) : null}
        <button
          type="button"
          onClick={() => ref.current?.close()}
          aria-label={messages.common.close}
          className="absolute right-3 top-3 inline-flex size-9 items-center justify-center rounded-full bg-bg/80 text-fg hover:bg-surface-3"
        >
          <X size={18} />
        </button>
      </dialog>
    </div>
  )
}
