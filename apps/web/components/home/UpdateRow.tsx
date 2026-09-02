import { canReadChapter, chapterLock, countdown, type SessionUser } from '@palscans/core'
import { fmt, messages } from '@palscans/core/messages'
import { cn, RelativeTime } from '@palscans/ui'
import { Lock, Pin } from 'lucide-react'
import Link from 'next/link'
import { Rating, StatusBadge, TypeBadge } from '@/components/discovery/Badges'
import { COVER_HEIGHT, COVER_WIDTH } from '@/components/discovery/media'
import type { ChapterSummary, UpdateItem } from '@/components/discovery/types'

const NEW_HOURS = 24

export interface UpdateRowProps {
  item: UpdateItem
  user: SessionUser | null
  now: Date
  /** Eager-load the cover (first rows are above the fold on desktop). */
  priority?: boolean
}

/**
 * One Latest-updates row (mockup: 144px card, 84×126 cover, title, type chip, rating, three
 * chapter pills with relative times). Pinned rows get the violet border + glow and a
 * PINNED badge; the newest chapter gets NEW inside the badge window; chapters the viewer
 * may not read show a lock instead of a bare link into the reader.
 */
export function UpdateRow({ item, user, now, priority = false }: UpdateRowProps) {
  const chapters = item.chapters.slice(0, 3)
  return (
    <article
      className={cn(
        'relative flex h-[144px] min-w-0 gap-2.5 overflow-hidden rounded-[10px] border bg-surface-1 p-2 transition-colors duration-[120ms]',
        item.isPinned ? 'border-brand shadow-(--glow-brand)' : 'border-line hover:border-fg-subtle',
      )}
    >
      <Link
        href={item.href}
        className="group block h-[126px] w-[84px] shrink-0 overflow-hidden rounded-md bg-surface-2"
        tabIndex={-1}
        aria-hidden="true"
      >
        <img
          src={item.coverSrc}
          alt=""
          width={COVER_WIDTH}
          height={COVER_HEIGHT}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          className={cn(
            'h-full w-full object-cover transition-transform duration-200 motion-safe:group-hover:scale-[1.04]',
            item.mature && 'blur-md',
          )}
        />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <Link
          href={item.href}
          className={cn(
            'block truncate text-[14px] font-bold leading-[18px] text-fg hover:text-brand-hover',
            item.isPinned && 'pr-[60px]',
          )}
        >
          {item.title}
        </Link>
        <div className="mt-1 flex h-[18px] items-center gap-1.5">
          <TypeBadge type={item.type} />
          {item.status !== 'ongoing' ? <StatusBadge status={item.status} /> : null}
          <Rating value={item.rating} count={item.ratingCount} />
        </div>
        <ul className="mt-1.5 flex flex-col gap-1">
          {chapters.map((c, i) => (
            <li key={c.id}>
              <ChapterPill chapter={c} first={i === 0} user={user} now={now} />
            </li>
          ))}
          {chapters.length === 0 ? (
            <li className="text-[12px] text-fg-subtle">{messages.series.emptyChapters}</li>
          ) : null}
        </ul>
      </div>
      {item.isPinned ? (
        <span className="absolute right-2 top-2 inline-flex h-[18px] items-center gap-1 rounded-sm border border-brand-hover/50 bg-brand/20 px-[7px] text-[10px] font-extrabold uppercase tracking-[0.08em] text-brand-hover">
          <Pin size={10} strokeWidth={2.5} aria-hidden="true" />
          {messages.home.pinned}
        </span>
      ) : null}
    </article>
  )
}

function ChapterPill({
  chapter,
  first,
  user,
  now,
}: {
  chapter: ChapterSummary
  first: boolean
  user: SessionUser | null
  now: Date
}) {
  const published = chapter.publishedAt ? new Date(chapter.publishedAt) : null
  const isNew =
    first && published !== null && now.getTime() - published.getTime() < NEW_HOURS * 3_600_000
  const access = {
    state: 'published',
    is_premium: chapter.isPremium,
    early_access_until: chapter.earlyAccessUntil ? new Date(chapter.earlyAccessUntil) : null,
  }
  const lock = chapterLock(access, now)
  const locked = lock !== 'none' && !canReadChapter(user, access, now)
  const lockLabel =
    lock === 'early_access' && access.early_access_until
      ? fmt(messages.series.earlyAccessFreeIn, {
          countdown: countdown(access.early_access_until, now),
        })
      : lock === 'premium'
        ? messages.series.premiumOnly
        : null
  return (
    <Link
      href={chapter.href}
      className={cn(
        'flex h-6 min-w-0 items-center justify-between gap-2 rounded-md px-2 text-[13px] transition-colors duration-[120ms] hover:bg-surface-3',
        first && isNew ? 'bg-brand-wash' : 'bg-surface-2',
      )}
    >
      <span
        className={cn(
          'inline-flex min-w-0 items-center gap-1.5 truncate text-fg',
          first ? 'font-bold' : 'font-semibold',
        )}
      >
        {fmt(messages.series.chapterShort, { n: chapter.number })}
        {isNew ? (
          <span className="inline-flex h-3.5 items-center rounded-[3px] bg-brand px-[5px] text-[9px] font-extrabold tracking-[0.08em] text-brand-ink">
            {messages.home.new}
          </span>
        ) : null}
        {locked ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gold">
            <Lock size={11} aria-label={messages.series.locked} />
            {lockLabel}
          </span>
        ) : null}
      </span>
      {chapter.publishedAt ? (
        <RelativeTime
          iso={chapter.publishedAt}
          className={cn('shrink-0 tabular-nums', first ? 'text-brand-hover' : 'text-fg-muted')}
        />
      ) : null}
    </Link>
  )
}
