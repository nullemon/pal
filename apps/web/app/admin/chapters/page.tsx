import { formatChapterNumber } from '@palscans/core'
import { messages } from '@palscans/core/messages'
import { chapters, getDb, series } from '@palscans/db'
import { and, count, desc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { PAGE_SIZE, parseSearch, type SearchParams } from '@/components/admin/server/params'
import {
  ChapterStatePill,
  EmptyRow,
  Num,
  PageHeader,
  Pagination,
  selectClass,
  Table,
  Td,
  Th,
  When,
} from '@/components/admin/ui'

const schema = z.object({
  state: z
    .enum(['draft', 'processing', 'ready', 'scheduled', 'published', 'failed', 'removed'])
    .optional()
    .catch(undefined),
  series: z.coerce.number().int().positive().optional().catch(undefined),
  chapter: z.coerce.number().int().positive().optional().catch(undefined),
  page: z.coerce.number().int().min(1).catch(1),
})

export default async function AdminChaptersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const p = parseSearch(schema, await searchParams)
  const db = await getDb()
  const where = and(
    isNull(chapters.deletedAt),
    p.state ? eq(chapters.state, p.state) : undefined,
    p.series ? eq(chapters.seriesId, p.series) : undefined,
    p.chapter ? eq(chapters.id, p.chapter) : undefined,
  )
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: chapters.id,
        number: chapters.number,
        title: chapters.title,
        state: chapters.state,
        isPremium: chapters.isPremium,
        publishedAt: chapters.publishedAt,
        pageCount: chapters.pageCount,
        viewCount: chapters.viewCount,
        seriesId: chapters.seriesId,
        seriesTitle: series.title,
        seriesSlug: series.slug,
        updatedAt: chapters.updatedAt,
      })
      .from(chapters)
      .innerJoin(series, eq(series.id, chapters.seriesId))
      .where(where)
      .orderBy(desc(chapters.updatedAt))
      .limit(PAGE_SIZE)
      .offset((p.page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(chapters).where(where),
  ])
  const pages = Math.max(1, Math.ceil((total?.n ?? 0) / PAGE_SIZE))
  const m = messages.admin.chapters
  const hrefFor = (page: number) => {
    const u = new URLSearchParams()
    if (p.state) u.set('state', p.state)
    if (p.series) u.set('series', String(p.series))
    u.set('page', String(page))
    return `/admin/chapters?${u.toString()}`
  }
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <form className="flex items-center gap-2" method="get" action="/admin/chapters">
        {p.series ? <input type="hidden" name="series" value={p.series} /> : null}
        <select
          name="state"
          defaultValue={p.state ?? ''}
          className={`${selectClass} w-44`}
          aria-label={m.colState}
        >
          <option value="">{messages.admin.all}</option>
          {Object.entries(m.states).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="h-9 rounded-md border border-line bg-surface-1 px-3 text-[13px] font-semibold hover:bg-surface-2"
        >
          {messages.admin.apply}
        </button>
      </form>
      <Table>
        <thead>
          <tr>
            <Th>{m.colChapter}</Th>
            <Th>{m.colSeries}</Th>
            <Th>{m.colState}</Th>
            <Th align="right">{m.colPages}</Th>
            <Th>{m.colPremium}</Th>
            <Th>{m.colPublished}</Th>
            <Th align="right">{m.colViews}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <EmptyRow colSpan={7} /> : null}
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-surface-2/60">
              <Td>
                <a
                  href={`/admin/series/${r.seriesId}?tab=chapters`}
                  className="font-semibold hover:text-brand-hover"
                >
                  Ch. {formatChapterNumber(r.number)}
                </a>
                {r.title ? <span className="ml-2 text-fg-muted">{r.title}</span> : null}
                {r.state === 'published' ? (
                  <a
                    href={`/series/${r.seriesSlug}/chapter-${formatChapterNumber(r.number)}`}
                    className="ml-2 text-[12px] text-fg-subtle hover:text-brand-hover"
                  >
                    {messages.admin.view} ↗
                  </a>
                ) : null}
              </Td>
              <Td className="max-w-[260px] truncate text-fg-muted">{r.seriesTitle}</Td>
              <Td>
                <ChapterStatePill state={r.state} />
              </Td>
              <Td align="right">
                <Num>{r.pageCount}</Num>
              </Td>
              <Td>
                {r.isPremium ? (
                  <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-gold">
                    Premium
                  </span>
                ) : (
                  '—'
                )}
              </Td>
              <Td className="text-fg-muted">
                <When date={r.publishedAt} />
              </Td>
              <Td align="right">
                <Num>{r.viewCount}</Num>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Pagination page={p.page} pages={pages} hrefFor={hrefFor} />
    </>
  )
}
