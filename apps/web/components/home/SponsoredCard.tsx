import { messages } from '@palscans/core/messages'

export interface SponsoredCardProps {
  /** True when the viewer holds `no_ads`: render nothing at all (docs/11). */
  noAds?: boolean
  /** Draw the dashed placeholder (no network tag configured, or a preview). */
  placeholder?: boolean
}

/**
 * `home_infeed` — the native card that takes the fifth cell of the Latest updates grid.
 * Same footprint as an update row, so nothing shifts when the network fills it.
 */
export function SponsoredCard({ noAds = false, placeholder = true }: SponsoredCardProps) {
  if (noAds) return null
  return (
    <aside
      data-ad-slot="home_infeed"
      data-ad-size="native"
      aria-label={messages.ads.sponsored}
      className={
        placeholder
          ? 'flex h-[144px] items-center gap-2.5 rounded-[10px] border border-dashed border-line bg-surface-2/45 p-2'
          : 'h-[144px] rounded-[10px]'
      }
    >
      {placeholder ? (
        <>
          <div className="h-[126px] w-[84px] shrink-0 rounded-md border border-dashed border-line bg-surface-3/35" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-subtle [font-variant-caps:all-small-caps]">
              {messages.ads.label} · {messages.ads.sponsored}
            </span>
            <span className="block h-3 w-[70%] rounded-sm bg-surface-3/60" />
            <span className="block h-3 w-[92%] rounded-sm bg-surface-3/45" />
            <span className="block h-3 w-[55%] rounded-sm bg-surface-3/45" />
            <span className="block h-6 w-24 rounded-md border border-dashed border-line" />
          </div>
        </>
      ) : null}
    </aside>
  )
}
