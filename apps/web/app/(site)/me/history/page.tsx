import { fmt, messages } from '@palscans/core/messages'
import { chapterReads, chapters, getDb, series } from '@palscans/db'
import { Button, Chip, EmptyState, RelativeTime } from '@palscans/ui'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { Metadata } from 'next'
import { getSessionUser } from '@/lib/auth'
import { mediaUrl } from '@/lib/auth/media'
import { historyQuerySchema } from '@/lib/auth/schemas'
import { siteCopy } from '@/lib/copy/settings'
import { DeviceHistory } from '@/lib/progress/DeviceHistory'
import { MergeDeviceProgress } from '@/lib/progress/DeviceProgress'
import { ClearHistoryButton } from '../_components/ClearHistoryButton'
import { PageTitle } from '../_components/Section'
import { flatParams, requireAccount, type SearchParams } from '../_lib'

export const metadata: Metadata = { title: messages.me.history.title }

const PAGE_SIZE = 40
const chapterHref = (slug: string, n: number) =>
  `/series/${slug}/chapter-${Number.parseFloat(n.toFixed(3))}`

/**
 * Reading history — every chapter opened, newest first (docs/02 chapter_reads).
 *
 * Signed out this page used to be a login wall. It is not any more: a reader who has been
 * reading anonymously has a history, it is just held in their own browser, and turning them
 * away at the door when they ask to see it is how a first-time visitor becomes a
 * never-again visitor. The signed-out view says plainly whose it is and where it lives.
 */
export default async function HistoryPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await flatParams(searchParams)
  const { page } = historyQuerySchema.safeParse(raw).data ?? { page: 1 }
  const path = page > 1 ? `/me/history?page=${page}` : '/me/history'
  if (!(await getSessionUser()))
    return (
      <>
        <PageTitle title={messages.localProgress.historyTitle} />
        <DeviceHistory signInHref={`/login?return=${encodeURIComponent(path)}`} />
      </>
    )
  const user = await requireAccount(path)
  const db = await getDb()
  const rows = await db
    .select({
      chapterId: chapters.id,
      number: chapters.number,
      chapterTitle: chapters.title,
      readAt: chapterReads.readAt,
      slug: series.slug,
      title: series.title,
      type: series.type,
      coverKey: series.coverKey,
    })
    .from(chapterReads)
    .innerJoin(chapters, eq(chapters.id, chapterReads.chapterId))
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(
      and(eq(chapterReads.userId, user.id), isNull(chapters.deletedAt), isNull(series.deletedAt)),
    )
    .orderBy(desc(chapterReads.readAt))
    .limit(PAGE_SIZE + 1)
    .offset((page - 1) * PAGE_SIZE)
  const hasMore = rows.length > PAGE_SIZE
  const items = rows.slice(0, PAGE_SIZE)
  const copy = await siteCopy()

  return (
    <>
      <MergeDeviceProgress userId={user.id} />
      <PageTitle title={messages.me.history.title}>
        {items.length ? <ClearHistoryButton /> : null}
      </PageTitle>
      {items.length === 0 ? (
        <EmptyState
          title={copy('account.emptyHistory')}
          action={
            <Button href="/browse" variant="outline">
              {messages.me.bookmarks.browse}
            </Button>
          }
        />
      ) : (
        <ol className="divide-y divide-line-soft rounded-lg border border-line bg-surface-1">
          {items.map((r) => (
            <li key={r.chapterId} className="flex items-center gap-3 p-3">
              <a
                href={`/series/${r.slug}`}
                className="shrink-0 overflow-hidden rounded-sm bg-surface-2"
              >
                {r.coverKey ? (
                  <img
                    src={mediaUrl(r.coverKey)}
                    alt=""
                    width={400}
                    height={600}
                    loading="lazy"
                    decoding="async"
                    className="aspect-[2/3] w-10 object-cover"
                  />
                ) : (
                  <span className="block aspect-[2/3] w-10" />
                )}
              </a>
              <div className="min-w-0 flex-1">
                <a
                  href={`/series/${r.slug}`}
                  className="line-clamp-1 text-sm font-bold text-fg hover:text-brand-hover"
                >
                  {r.title}
                </a>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-fg-muted">
                  {r.type === 'novel' ? (
                    <Chip variant="genre" size="sm">
                      {messages.series.type.novel}
                    </Chip>
                  ) : (
                    <Chip variant="type" value={r.type} size="sm" />
                  )}
                  <span>
                    {fmt(messages.me.history.chapter, {
                      n: Number.parseFloat(r.number.toFixed(3)),
                    })}
                  </span>
                  {r.chapterTitle ? <span className="truncate">· {r.chapterTitle}</span> : null}
                  <span>
                    · <RelativeTime iso={r.readAt.toISOString()} />
                  </span>
                </p>
              </div>
              <Button href={chapterHref(r.slug, r.number)} variant="outline" size="sm">
                {messages.me.history.continue}
              </Button>
            </li>
          ))}
        </ol>
      )}
      {page > 1 || hasMore ? (
        <nav
          aria-label={messages.discovery.pagination}
          className="mt-6 flex items-center justify-between"
        >
          {page > 1 ? (
            <Button href={`/me/history?page=${page - 1}`} variant="outline" size="sm">
              {messages.discovery.prevPage}
            </Button>
          ) : (
            <span />
          )}
          {hasMore ? (
            <Button href={`/me/history?page=${page + 1}`} variant="outline" size="sm">
              {messages.discovery.nextPage}
            </Button>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </>
  )
}
