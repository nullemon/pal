'use client'

import { messages } from '@palscans/core/messages'
import { useRef } from 'react'

export interface ScrubberProps {
  count: number
  current: number
  onChange: (idx: number) => void
  /** Desktop: 14px tall with a tick per page. Mobile: a 2px track with a knob. */
  variant: 'ticks' | 'thin'
  className?: string
}

/** The paged mode's scrubber (docs/06): one tick per page, the current one lit. */
export function Scrubber({ count, current, onChange, variant, className }: ScrubberProps) {
  const ref = useRef<HTMLDivElement>(null)
  const pct = count <= 1 ? 0 : (current / (count - 1)) * 100
  const pick = (clientX: number) => {
    const el = ref.current
    if (!el || count <= 1) return
    const r = el.getBoundingClientRect()
    const x = Math.min(r.width, Math.max(0, clientX - r.left))
    onChange(Math.round((x / r.width) * (count - 1)))
  }
  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label={messages.readerUi.pageScrubber}
      aria-valuemin={1}
      aria-valuemax={count}
      aria-valuenow={current + 1}
      onPointerDown={(e) => {
        e.preventDefault()
        pick(e.clientX)
        const move = (ev: PointerEvent) => pick(ev.clientX)
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Home') onChange(0)
        if (e.key === 'End') onChange(count - 1)
      }}
      className={`relative cursor-pointer touch-none select-none ${variant === 'ticks' ? 'h-3.5' : 'h-0.5'} ${className ?? ''}`}
    >
      <div
        className={`absolute inset-x-0 rounded-px bg-white/[.12] ${variant === 'ticks' ? 'top-1.5 h-0.5' : 'inset-y-0'}`}
      />
      <div
        className={`absolute left-0 rounded-px bg-brand-hover ${variant === 'ticks' ? 'top-1.5 h-0.5' : 'inset-y-0'}`}
        style={{ width: `${pct}%` }}
      />
      {variant === 'ticks' ? (
        <div className="absolute inset-0 flex items-center justify-between">
          {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
            <span
              key={n}
              aria-hidden="true"
              className={
                n - 1 === current
                  ? 'h-3.5 w-[3px] rounded-[2px] bg-brand-hover shadow-[0_0_8px_rgb(139_92_246_/_0.75)]'
                  : 'h-2 w-px rounded-px bg-white/[.28]'
              }
            />
          ))}
        </div>
      ) : (
        <span
          aria-hidden="true"
          className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-hover shadow-[0_0_0_3px_rgb(139_92_246_/_0.25),0_0_10px_rgb(139_92_246_/_0.6)]"
          style={{ left: `${pct}%` }}
        />
      )}
    </div>
  )
}
