import { formatChapterLabel } from '@palscans/core/formatting'
import { fmt, messages } from '@palscans/core/messages'
import { cn } from '@palscans/ui'
import { Flame } from 'lucide-react'
import Link from 'next/link'
import { COVER_HEIGHT, COVER_WIDTH } from '@/components/discovery/media'
import { SectionTitle } from '@/components/discovery/SectionTitle'
import type { RankedSeries } from '@/components/discovery/types'
import { siteFormatting } from '@/lib/copy/settings'

/**
 * Trending: 150×225 covers with the rank as an outlined numeral in the corner, the title
 * and latest chapter over a gradient. A scroll-snap rail; eight fit the desktop container.
 */
export async function TrendingRail({ items }: { items: RankedSeries[] }) {
  const { chapterLabel: chapterStyle } = await siteFormatting()
  if (items.length === 0) return null
  return (
    <section aria-labelledby="trending-title" className="flex flex-col gap-2">
      <SectionTitle
        id="trending-title"
        title={messages.home.trending}
        icon={<Flame size={18} />}
        link={{ href: '/rankings', label: messages.nav.rankings }}
      />
      <ul className="flex snap-x gap-3 overflow-x-auto overscroll-x-contain pb-2 [scrollbar-width:thin] lg:gap-[22px]">
        {items.map((s, i) => (
          <li key={s.id} className="w-[150px] shrink-0 snap-start">
            <Link href={s.href} className="group relative block h-[225px] w-[150px] text-fg">
              <span className="block h-full overflow-hidden rounded-md shadow-2">
                <img
                  src={s.coverSrc}
                  alt={fmt(messages.discovery.coverAlt, { title: s.title })}
                  width={COVER_WIDTH}
                  height={COVER_HEIGHT}
                  loading={i < 4 ? 'eager' : 'lazy'}
                  decoding="async"
                  className={cn(
                    'h-full w-full object-cover transition-transform duration-200 motion-safe:group-hover:scale-[1.04]',
                    s.mature && 'blur-md',
                  )}
                />
              </span>
              <span className="absolute inset-x-0 bottom-0 block rounded-b-md bg-linear-to-b from-bg/0 to-bg/95 to-60% px-2 pb-2 pt-[34px]">
                <span className="block truncate pl-10 text-[13px] font-bold leading-4">
                  {s.title}
                </span>
                {s.latest ? (
                  <span className="block pl-10 text-[12px] leading-[14px] text-fg-muted">
                    {formatChapterLabel(s.latest.number, chapterStyle)}
                  </span>
                ) : null}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  'absolute -bottom-1.5 -left-0.5 font-display text-[62px] font-extrabold leading-none tracking-[-0.05em] text-transparent',
                  s.rank === 1
                    ? '[-webkit-text-stroke:2px_var(--color-brand-hover)]'
                    : '[-webkit-text-stroke:2px_var(--color-fg)]',
                )}
              >
                {s.rank}
              </span>
              <span className="sr-only">{fmt(messages.series.rank, { n: s.rank })}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
