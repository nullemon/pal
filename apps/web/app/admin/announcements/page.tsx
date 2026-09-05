import { fmt, messages } from '@palscans/core/messages'
import { Plus } from 'lucide-react'
import { z } from 'zod'
import { loadAnnouncementList } from '@/components/admin/content/queries'
import { pageSchema, parseSearch, type SearchParams } from '@/components/admin/server/params'
import {
  EmptyRow,
  inputClass,
  PageHeader,
  Pagination,
  Pill,
  PubStatePill,
  selectClass,
  Table,
  Td,
  Th,
  When,
} from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'

const schema = z.object({
  q: z.string().trim().max(100).optional(),
  state: z
    .enum(['draft', 'scheduled', 'published', 'unlisted', 'removed'])
    .optional()
    .catch(undefined),
  page: pageSchema,
})

const STATES = ['draft', 'scheduled', 'published', 'unlisted', 'removed'] as const

/** /admin/announcements — the list (docs/04 Content · Announcements). */
export default async function AdminAnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  await withPermission('announcement.write', { returnTo: '/admin/announcements' })
  const p = parseSearch(schema, await searchParams)
  const { rows, total, pages } = await loadAnnouncementList(p)
  const m = messages.adminContent.announcements
  const hrefFor = (page: number) => {
    const u = new URLSearchParams()
    if (p.q) u.set('q', p.q)
    if (p.state) u.set('state', p.state)
    u.set('page', String(page))
    return `/admin/announcements?${u.toString()}`
  }
  return (
    <>
      <PageHeader
        title={m.title}
        subtitle={fmt(m.subtitle, { n: total })}
        actions={
          <a
            href="/admin/announcements/new"
            className="inline-flex h-9 items-center gap-2 rounded-[9px] bg-brand px-4 text-[13px] font-bold text-brand-ink hover:bg-brand-hover"
          >
            <Plus size={14} aria-hidden="true" />
            {m.newAnnouncement}
          </a>
        }
      />
      <form
        className="flex flex-wrap items-center gap-2"
        method="get"
        action="/admin/announcements"
      >
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
          {STATES.map((s) => (
            <option key={s} value={s}>
              {s}
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
            <Th>{m.colTitle}</Th>
            <Th>{m.colState}</Th>
            <Th>{m.colTags}</Th>
            <Th>{m.colAuthor}</Th>
            <Th align="right">{m.colPublished}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <EmptyRow colSpan={5}>{m.empty}</EmptyRow> : null}
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-surface-2/60">
              <Td>
                <a href={`/admin/announcements/${r.id}`} className="block min-w-0">
                  <span className="block truncate font-semibold hover:text-brand-hover">
                    {r.title}
                  </span>
                  <span className="block truncate text-[12px] text-fg-subtle">
                    /announcements/{r.slug}
                  </span>
                </a>
              </Td>
              <Td>
                <PubStatePill state={r.state} />
              </Td>
              <Td>
                <span className="flex flex-wrap gap-1">
                  {r.tags.map((t) => (
                    <Pill key={t} tone="brand">
                      {t}
                    </Pill>
                  ))}
                </span>
              </Td>
              <Td className="text-fg-muted">{r.author ?? '—'}</Td>
              <Td align="right" className="text-fg-muted">
                <When date={r.publishedAt ?? r.updatedAt} />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Pagination page={p.page} pages={pages} hrefFor={hrefFor} />
    </>
  )
}
