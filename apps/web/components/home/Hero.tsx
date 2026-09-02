import { fmt, messages } from '@palscans/core/messages'
import { COVER_HEIGHT, COVER_WIDTH } from '@/components/discovery/media'
import type { HeroSlide } from '@/components/discovery/types'
import { HeroCarousel, type HeroSlideData } from './HeroCarousel'

const typeClass: Record<HeroSlide['type'], string> = {
  manhwa: 'bg-type-manhwa text-white',
  manhua: 'bg-type-manhua text-white',
  manga: 'bg-type-manga text-white',
  comic: 'bg-type-comic text-bg',
  novel: 'bg-surface-3 text-fg',
}

/** Server wrapper: turns hero slides into the plain data the client carousel renders. */
export function Hero({ slides }: { slides: HeroSlide[] }) {
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
          label: fmt(messages.series.chapterShort, { n: s.latest.number }),
          publishedAt: s.latest.publishedAt,
          href: s.latest.href,
        }
      : null,
  }))
  return <HeroCarousel slides={data} />
}
