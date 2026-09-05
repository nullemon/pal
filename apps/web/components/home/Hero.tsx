import { formatChapterLabel } from '@palscans/core/formatting'
import { messages } from '@palscans/core/messages'
import { COVER_HEIGHT, COVER_WIDTH } from '@/components/discovery/media'
import type { HeroSlide } from '@/components/discovery/types'
import { siteFormatting } from '@/lib/copy/settings'
import { HeroCarousel, type HeroSlideData } from './HeroCarousel'

const typeClass: Record<HeroSlide['type'], string> = {
  manhwa: 'bg-type-manhwa text-type-manhwa-ink',
  manhua: 'bg-type-manhua text-type-manhua-ink',
  manga: 'bg-type-manga text-type-manga-ink',
  comic: 'bg-type-comic text-type-comic-ink',
  novel: 'bg-surface-3 text-fg',
}

/** Server wrapper: turns hero slides into the plain data the client carousel renders. */
export async function Hero({ slides }: { slides: HeroSlide[] }) {
  const { chapterLabel: chapterStyle } = await siteFormatting()
  if (slides.length === 0) return null
  const data: HeroSlideData[] = slides.map((s) => ({
    id: s.id,
    title: s.title,
    href: s.href,
    coverSrc: s.coverSrc,
    coverWidth: COVER_WIDTH,
    coverHeight: COVER_HEIGHT,
    typeLabel: messages.series.type[s.type],
    typeClass: typeClass[s.type],
    rating: s.ratingCount > 0 ? s.rating : null,
    latest: s.latest
      ? {
          label: formatChapterLabel(s.latest.number, chapterStyle),
          publishedAt: s.latest.publishedAt,
          href: s.latest.href,
        }
      : null,
  }))
  return <HeroCarousel slides={data} />
}
