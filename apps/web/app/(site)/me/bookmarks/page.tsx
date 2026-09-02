import { fmt, messages } from '@palscans/core/messages'
import { bookmarks, chapters, getDb, series } from '@palscans/db'
import { Button, cn, EmptyState } from '@palscans/ui'
import { and, desc, eq, isNull, max, ne, sql } from 'drizzle-orm'
import type { Metadata } from 'next'
import Link from 'next/link'
import { mediaUrl } from '@/lib/auth/media'
import { BOOKMARK_STATUSES, type BookmarkStatus, bookmarksQuerySchema } from '@/lib/auth/schemas'
import { BookmarkCard, type BookmarkItem } from '../_components/BookmarkCard'
import { PageTitle } from '../_components/Section'
import { flatParams, requireAccount, type SearchParams } from '../_lib'

export const metadata: Metadata = { title: messages.me.bookmarks.title }

const PAGE_SIZE = 24

const coverFor = (key: string | null, color: string | null) => {
  if (key) return mediaUrl(key)
  const fill = color && /^#[0-9a-f]{3,8}$/i.test(color) ? color : '#26203a'
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="100%" height="100%" fill="${fill}"/></svg>`)}`
}

/** Bookmarks — five shelves × comics / novels tabs (docs/13 bookmark statuses). */
export default async function BookmarksPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await flatParams(searchParams)
  const query = bookmarksQuerySchema.safeParse(raw)
  const { status, kind, page } = query.success
    ? query.data
    : { status: undefined, kind: 'comics' as const, page: 1 }
  const path = `/me/bookmarks${Object.keys(raw).length ? `?${new URLSearchParams(raw)}` : ''}`
  const user = await requireAccount(path)
  const db = await getDb()

  const kindFilter = kind === 'novels' ? eq(series.type, 'novel') : ne(series.type, 'novel')
  const base = and(
    eq(bookmarks.userId, user.id),
    isNull(series.deletedAt),
    eq(series.state, 'published'),
  )

  const counts = await db
    .select({ status: bookmarks.status, type: series.type, n: sql<number>`count(*)::int` })
    .from(bookmarks)
    .innerJoin(series, eq(series.id, bookmarks.seriesId))
    .where(base)
    .groupBy(bookmarks.status, series.type)
  const countFor = (s: BookmarkStatus | 'all', k: 'comics' | 'novels') =>
    counts
      .filter(
        (c) =>
          (k === 'novels' ? c.type === 'novel' : c.type !== 'novel') &&
          (s === 'all' || c.status === s),
      )
      .reduce((sum, c) => sum + c.n, 0)

  const latest = db
    .select({ seriesId: chapters.seriesId, latest: max(chapters.number).as('latest') })
    .from(chapters)
    .where(and(eq(chapters.state, 'published'), isNull(chapters.deletedAt)))
    .groupBy(chapters.seriesId)
    .as('latest')

  const rows = await db
    .select({
      seriesId: series.id,
      slug: series.slug,
      title: series.title,
      type: series.type,
      coverKey: series.coverKey,
      coverColor: series.coverColor,
      status: bookmarks.status,
      latestChapter: latest.latest,
      lastChapterAt: series.lastChapterAt,
    })
    .from(bookmarks)
    .innerJoin(series, eq(series.id, bookmarks.seriesId))
    .leftJoin(latest, eq(latest.seriesId, series.id))
    .where(and(base, kindFilter, status ? eq(bookmarks.status, status) : undefined))
    .orderBy(desc(series.lastChapterAt), desc(bookmarks.createdAt))
    .limit(PAGE_SIZE + 1)
    .offset((page - 1) * PAGE_SIZE)

  const hasMore = rows.length > PAGE_SIZE
  const items: BookmarkItem[] = rows.slice(0, PAGE_SIZE).map((r) => ({
    seriesId: r.seriesId,
    slug: r.slug,
    title: r.title,
    type: r.type,
    cover: coverFor(r.coverKey, r.coverColor),
    status: (BOOKMARK_STATUSES as readonly string[]).includes(r.status)
      ? (r.status as BookmarkStatus)
      : 'reading',
    latestChapter: r.latestChapter === null ? null : Number(r.latestChapter),
    lastChapterAt: r.lastChapterAt?.toISOString() ?? null,
  }))

  const link = (next: {
    kind?: 'comics' | 'novels'
    status?: BookmarkStatus | 'all'
    page?: number
  }) => {
    const p = new URLSearchParams()
    const k = next.kind ?? kind
    const s = next.status === undefined ? status : next.status === 'all' ? undefined : next.status
    if (k !== 'comics') p.set('kind', k)
    if (s) p.set('status', s)
    if (next.page && next.page > 1) p.set('page', String(next.page))
    const qs = p.toString()
    return qs ? `/me/bookmarks?${qs}` : '/me/bookmarks'
  }

  const tabClass = (active: boolean) =>
    cn(
      'inline-flex h-9 items-center rounded-md px-3 text-sm font-semibold transition-colors',
      active ? 'bg-surface-3 text-fg' : 'text-fg-muted hover:text-fg',
    )
  const chipClass = (active: boolean) =>
    cn(
      'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] font-bold uppercase tracking-[0.06em] transition-colors',
      active
        ? 'border-brand bg-brand-wash text-fg'
        : 'border-line bg-surface-1 text-fg-muted hover:text-fg',
    )
  const total = countFor(status ?? 'all', kind)

  return (
    <>
      <PageTitle title={messages.me.bookmarks.title}>
        <p className="text-[13px] text-fg-muted">
          {fmt(messages.me.bookmarks.count, { n: total })}
        </p>
      </PageTitle>
      <div
        className="mb-4 inline-flex rounded-lg border border-line bg-surface-1 p-1"
        role="tablist"
      >
        <Link
          role="tab"
          aria-selected={kind === 'comics'}
          href={link({ kind: 'comics', page: 1 })}
          className={tabClass(kind === 'comics')}
        >
          {messages.me.bookmarks.comics}
          <span className="ml-1.5 text-[12px] text-fg-subtle">{countFor('all', 'comics')}</span>
        </Link>
        <Link
          role="tab"
          aria-selected={kind === 'novels'}
          href={link({ kind: 'novels', page: 1 })}
          className={tabClass(kind === 'novels')}
        >
          {messages.me.bookmarks.novels}
          <span className="ml-1.5 text-[12px] text-fg-subtle">{countFor('all', 'novels')}</span>
        </Link>
      </div>
      <div className="-mx-1 mb-5 flex gap-2 overflow-x-auto px-1 pb-1">
        <Link href={link({ status: 'all', page: 1 })} className={chipClass(!status)}>
          {messages.me.bookmarks.all}
          <span className="text-fg-subtle">{countFor('all', kind)}</span>
        </Link>
        {BOOKMARK_STATUSES.map((s) => (
          <Link key={s} href={link({ status: s, page: 1 })} className={chipClass(status === s)}>
            {messages.series.bookmarkStatus[s]}
            <span className="text-fg-subtle">{countFor(s, kind)}</span>
          </Link>
        ))}
      </div>

      {items.length === 0 ? (
        <EmptyState
          title={
            kind === 'novels' && !status
              ? messages.me.bookmarks.emptyNovels
              : status
                ? fmt(messages.me.bookmarks.emptyStatus, {
                    status: messages.series.bookmarkStatus[status],
                  })
                : messages.account.emptyBookmarks
          }
          action={
            <Button href="/browse" variant="outline">
              {messages.me.bookmarks.browse}
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <BookmarkCard key={item.seriesId} item={item} />
          ))}
        </div>
      )}
      {page > 1 || hasMore ? (
        <nav
          aria-label={messages.discovery.pagination}
          className="mt-6 flex items-center justify-between"
        >
          {page > 1 ? (
            <Button href={link({ page: page - 1 })} variant="outline" size="sm">
              {messages.discovery.prevPage}
            </Button>
          ) : (
            <span />
          )}
          <span className="text-[12px] text-fg-muted">{fmt(messages.home.page, { n: page })}</span>
          {hasMore ? (
            <Button href={link({ page: page + 1 })} variant="outline" size="sm">
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
