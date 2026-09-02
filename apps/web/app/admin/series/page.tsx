import { compactNumber } from '@palscans/core'
import { fmt, messages } from '@palscans/core/messages'
import { Chip } from '@palscans/ui'
import { Plus } from 'lucide-react'
import { z } from 'zod'
import { parseSearch, type SearchParams } from '@/components/admin/server/params'
import { loadSeriesList } from '@/components/admin/server/series'
import {
  EmptyRow,
  inputClass,
  Num,
  PageHeader,
  Pagination,
  PubStatePill,
  selectClass,
  Table,
  Td,
  Th,
  When,
} from '@/components/admin/ui'
import { coverSrc } from '@/components/discovery/media'

const schema = z.object({
  q: z.string().trim().max(100).optional(),
  state: z
    .enum(['draft', 'scheduled', 'published', 'unlisted', 'removed'])
    .optional()
    .catch(undefined),
  type: z.enum(['manga', 'manhwa', 'manhua', 'comic', 'novel']).optional().catch(undefined),
  page: z.coerce.number().int().min(1).catch(1),
  trash: z.coerce.boolean().catch(false),
})

export default async function AdminSeriesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const p = parseSearch(schema, await searchParams)
  const { rows, total, pages } = await loadSeriesList(p)
  const m = messages.admin.series
  const hrefFor = (page: number) => {
    const u = new URLSearchParams()
    if (p.q) u.set('q', p.q)
    if (p.state) u.set('state', p.state)
    if (p.type) u.set('type', p.type)
    if (p.trash) u.set('trash', '1')
    u.set('page', String(page))
    return `/admin/series?${u.toString()}`
  }
  return (
    <>
      <PageHeader
        title={m.title}
        subtitle={fmt(m.subtitle, { n: total })}
        actions={
          <a
            href="/admin/series/new"
            className="inline-flex h-9 items-center gap-2 rounded-[9px] bg-brand px-4 text-[13px] font-bold text-brand-ink hover:bg-brand-hover"
          >
            <Plus size={14} aria-hidden="true" />
            {m.newSeries}
          </a>
        }
      />
      <form className="flex flex-wrap items-center gap-2" method="get" action="/admin/series">
        <input
          name="q"
          defaultValue={p.q ?? ''}
          placeholder={m.searchPlaceholder}
          className={`${inputClass} max-w-xs`}
        />
        <select
          name="state"
          defaultValue={p.state ?? ''}
          className={`${selectClass} w-40`}
          aria-label={m.colState}
        >
          <option value="">{messages.admin.all}</option>
          {['draft', 'scheduled', 'published', 'unlisted', 'removed'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          name="type"
          defaultValue={p.type ?? ''}
          className={`${selectClass} w-36`}
          aria-label={m.colType}
        >
          <option value="">{messages.admin.all}</option>
          {['manhwa', 'manhua', 'manga', 'comic', 'novel'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-[13px] text-fg-muted">
          <input type="checkbox" name="trash" value="1" defaultChecked={p.trash} />{' '}
          {messages.common.delete}d
        </label>
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
            <Th>{m.colTitle}</Th>
            <Th>{m.colType}</Th>
            <Th>{m.colState}</Th>
            <Th align="right">{m.colChapters}</Th>
            <Th align="right">{m.colViews}</Th>
            <Th align="right">{m.colUpdated}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <EmptyRow colSpan={6} /> : null}
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-surface-2/60">
              <Td>
                <a href={`/admin/series/${r.id}`} className="flex items-center gap-3">
                  <img
                    src={coverSrc(r.coverKey, r.coverColor)}
                    width={28}
                    height={42}
                    alt=""
                    loading="lazy"
                    className="h-[42px] w-7 shrink-0 rounded-sm object-cover"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold hover:text-brand-hover">
                      {r.title}
                    </span>
                    <span className="block truncate text-[12px] text-fg-subtle">/{r.slug}</span>
                  </span>
                </a>
              </Td>
              <Td>
                {r.type === 'novel' ? (
                  <span className="text-fg-muted">novel</span>
                ) : (
                  <Chip variant="type" value={r.type} size="sm" />
                )}
              </Td>
              <Td>
                <PubStatePill state={r.state} />
                {r.isFeatured ? <span className="ml-2 text-[11px] text-gold">★</span> : null}
              </Td>
              <Td align="right">
                <Num>{r.chapterCount}</Num>
              </Td>
              <Td align="right">
                <Num>{compactNumber(r.viewCount)}</Num>
              </Td>
              <Td align="right" className="text-fg-muted">
                <When date={r.lastChapterAt ?? r.updatedAt} />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Pagination page={p.page} pages={pages} hrefFor={hrefFor} />
    </>
  )
}
