import { messages } from '@palscans/core/messages'
import { AdTag } from '@palscans/ui'

export interface SponsoredCardProps {
  /** True when the viewer holds `no_ads`: render nothing at all (docs/11). */
  noAds?: boolean
  /** Draw the dashed placeholder (no network tag configured, or a preview). */
  placeholder?: boolean
  /**
   * The network's tag for `home_infeed`, from `Admin → Business → Ads`.
   *
   * It used to stop at the caller: the card took a `placeholder` flag and nothing else, so
   * an operator who pasted a tag into this slot got a 144px hole in the Latest updates grid
   * and no ad — configured, reserved, and earning nothing, with the settings screen showing
   * it as live. Every other slot on the site reaches `AdTag`; this one now does too.
   */
  tag?: string | null
}

/**
 * `home_infeed` — the native card that takes the fifth cell of the Latest updates grid.
 * Same footprint as an update row, so nothing shifts when the network fills it.
 */
export function SponsoredCard({
  noAds = false,
  placeholder = true,
  tag = null,
}: SponsoredCardProps) {
  if (noAds) return null
  // A filled slot belongs to the network: no dashed outline and no label over the creative.
  const showPlaceholder = placeholder && !tag
  return (
    <aside
      data-ad-slot="home_infeed"
      data-ad-size="native"
      aria-label={messages.ads.sponsored}
      className={
        showPlaceholder
          ? 'flex h-[144px] items-center gap-2.5 rounded-[10px] border border-dashed border-line bg-surface-2/45 p-2'
          : 'flex h-[144px] items-center justify-center overflow-hidden rounded-[10px]'
      }
    >
      {showPlaceholder ? (
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
      {tag ? <AdTag slot="home_infeed" html={tag} /> : null}
    </aside>
  )
}
