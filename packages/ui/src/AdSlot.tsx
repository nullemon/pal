import { messages } from '@palscans/core/messages'
import { cn } from './cn'

export interface AdSlotProps {
  /** Slot id from docs/11 — `home_top`, `home_sidebar`, `reader_end`, … */
  slot: string
  width: number
  height: number
  /** True when the viewer holds the `no_ads` entitlement: renders nothing at all. */
  noAds?: boolean
  /** Shown in the placeholder label, e.g. "Leaderboard". */
  label?: string
  /**
   * Draw the dashed outline and label. Defaults to true outside production; the ads
   * settings screen can force it on to preview placements.
   */
  placeholder?: boolean
  className?: string
}

const isDev = process.env.NODE_ENV !== 'production'

/**
 * A reserved box with the slot's final dimensions, so nothing shifts when an ad network
 * fills it. In development it is a dashed outline with a small-caps label.
 */
export function AdSlot({
  slot,
  width,
  height,
  noAds = false,
  label,
  placeholder = isDev,
  className,
}: AdSlotProps) {
  if (noAds) return null
  const showLabel = placeholder
  return (
    <div
      data-ad-slot={slot}
      data-ad-size={`${width}x${height}`}
      style={{ width, height, maxWidth: '100%' }}
      className={cn(
        'mx-auto flex items-center justify-center rounded-sm text-fg-subtle',
        showLabel && 'border border-dashed border-line bg-surface-1/50',
        className,
      )}
    >
      {showLabel ? (
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] [font-variant-caps:all-small-caps]">
          {messages.ads.label} · {label ?? slot} {width}×{height}
        </span>
      ) : null}
    </div>
  )
}
