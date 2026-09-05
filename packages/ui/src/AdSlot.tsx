import { messages } from '@palscans/core/messages'
import { AdTag } from './AdTag'
import { cn } from './cn'

export interface AdSlotProps {
  /** Slot id from docs/11 — `home_top`, `home_sidebar`, `reader_end`, … */
  slot: string
  /** Reserved box below the `md` breakpoint. */
  width: number
  height: number
  /**
   * Reserved box at `md` and above. Omit when the slot is one size everywhere.
   *
   * This is a prop rather than two `<AdSlot>`s behind `hidden md:block`, which is what the
   * layouts used to do: that puts *two* elements with the same slot id in the DOM, and an ad
   * tag rendered into both fires the same slot twice — a double request to the network and a
   * double impression.
   */
  desktopWidth?: number
  desktopHeight?: number
  /** True when the viewer holds the `no_ads` entitlement: renders nothing at all. */
  noAds?: boolean
  /** Shown in the placeholder label, e.g. "Leaderboard". */
  label?: string
  /**
   * Draw the dashed outline and label. Defaults to true outside production; the ads
   * settings screen can force it on to preview placements.
   */
  placeholder?: boolean
  /**
   * The network's tag for this slot (`Admin → Business → Ads`). Rendered and executed by
   * `AdTag`; null leaves the box reserved and empty, which is the state before a network is
   * signed up.
   */
  tag?: string | null
  className?: string
}

const isDev = process.env.NODE_ENV !== 'production'

/**
 * A reserved box at the slot's final dimensions, so nothing shifts when the network fills it
 * (docs/11). One element per slot, sized by CSS custom properties so the desktop and mobile
 * sizes do not need two elements. Empty until `Admin → Business → Ads` has a tag for it.
 */
export function AdSlot({
  slot,
  width,
  height,
  desktopWidth,
  desktopHeight,
  noAds = false,
  label,
  placeholder = isDev,
  tag = null,
  className,
}: AdSlotProps) {
  if (noAds) return null
  const filled = Boolean(tag)
  // The label is for empty placements; once a tag is in, the network owns the box.
  const showLabel = placeholder && !filled
  return (
    <div
      data-ad-slot={slot}
      data-ad-size={`${width}x${height}`}
      style={
        {
          '--ad-w': `${width}px`,
          '--ad-h': `${height}px`,
          ...(desktopWidth ? { '--ad-w-md': `${desktopWidth}px` } : {}),
          ...(desktopHeight ? { '--ad-h-md': `${desktopHeight}px` } : {}),
          maxWidth: '100%',
        } as React.CSSProperties
      }
      className={cn(
        'mx-auto flex items-center justify-center overflow-hidden rounded-sm text-fg-subtle',
        showLabel && 'border border-dashed border-line bg-surface-1/50',
        className,
      )}
    >
      {showLabel ? (
        <span className="font-semibold text-[11px] uppercase tracking-[0.12em] [font-variant-caps:all-small-caps]">
          {messages.ads.label} · {label ?? slot}{' '}
          {desktopWidth
            ? `${width}×${height} / ${desktopWidth}×${desktopHeight}`
            : `${width}×${height}`}
        </span>
      ) : null}
      {tag ? <AdTag slot={slot} html={tag} /> : null}
    </div>
  )
}
