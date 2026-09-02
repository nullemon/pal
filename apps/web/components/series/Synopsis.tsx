'use client'

import { messages } from '@palscans/core/messages'
import { cn, Sheet } from '@palscans/ui'
import { useEffect, useRef, useState } from 'react'

/** Clamps to 4 lines with "Show more"; below `md` the expansion is a bottom sheet (docs/06). */
export function Synopsis({
  text,
  title,
  className,
}: {
  text: string
  title: string
  className?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [clamped, setClamped] = useState(false)
  const ref = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setClamped(el.scrollHeight > el.clientHeight + 2)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const toggle = () => {
    if (window.matchMedia('(max-width: 767px)').matches) setSheet(true)
    else setExpanded((e) => !e)
  }

  return (
    <div className={className}>
      <p
        ref={ref}
        className={cn('m-0 text-base leading-[26px] text-fg-muted', !expanded && 'line-clamp-4')}
      >
        {text}
      </p>
      {clamped || expanded ? (
        <button
          type="button"
          onClick={toggle}
          className="mt-1 text-[13px] font-semibold text-brand-hover hover:text-fg"
        >
          {expanded ? messages.seriesDetail.showLess : messages.seriesDetail.showMore}
        </button>
      ) : null}
      <Sheet open={sheet} onClose={() => setSheet(false)} title={title}>
        <p className="m-0 p-4 text-[15px] leading-[26px] text-fg">{text}</p>
      </Sheet>
    </div>
  )
}
