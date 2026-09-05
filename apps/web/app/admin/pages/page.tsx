import { fmt, messages } from '@palscans/core/messages'
import { Plus } from 'lucide-react'
import { loadPageList } from '@/components/admin/content/queries'
import { publicPagePath } from '@/components/admin/content/schemas'
import {
  EmptyRow,
  Hint,
  Num,
  PageHeader,
  Pill,
  PubStatePill,
  Table,
  Td,
  Th,
  When,
} from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'

/** /admin/pages — the static pages the site renders (docs/13 "Legal pages"). */
export default async function AdminPagesPage() {
  await withPermission('settings.write', { returnTo: '/admin/pages' })
  const rows = await loadPageList()
  const m = messages.adminContent.pages
  return (
    <>
      <PageHeader
        title={m.title}
        subtitle={fmt(m.subtitle, { n: rows.length })}
        actions={
          <a
            href="/admin/pages/new"
            className="inline-flex h-9 items-center gap-2 rounded-[9px] bg-brand px-4 text-[13px] font-bold text-brand-ink hover:bg-brand-hover"
          >
            <Plus size={14} aria-hidden="true" />
            {m.newPage}
          </a>
        }
      />
      <Hint>{m.legalHint}</Hint>
      <Table>
        <thead>
          <tr>
            <Th>{m.colTitle}</Th>
            <Th>{m.colState}</Th>
            <Th align="right">{m.colVersion}</Th>
            <Th>{m.colUpdatedBy}</Th>
            <Th align="right">{m.colUpdated}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <EmptyRow colSpan={5}>{m.empty}</EmptyRow> : null}
          {rows.map((r) => {
            const path = publicPagePath(r.slug)
            return (
              <tr key={r.id} className="hover:bg-surface-2/60">
                <Td>
                  <a href={`/admin/pages/${r.id}`} className="block min-w-0">
                    <span className="block truncate font-semibold hover:text-brand-hover">
                      {r.title}
                    </span>
                    <span className="block truncate text-[12px] text-fg-subtle">
                      {path ?? `/${r.slug}`}
                    </span>
                  </a>
                </Td>
                <Td>
                  <span className="flex items-center gap-1.5">
                    <PubStatePill state={r.state} />
                    {path ? null : <Pill tone="warn">{m.notRendered}</Pill>}
                  </span>
                </Td>
                <Td align="right">
                  <Num>{Number(r.version)}</Num>
                </Td>
                <Td className="text-fg-muted">{r.updatedBy ?? '—'}</Td>
                <Td align="right" className="text-fg-muted">
                  <When date={r.updatedAt} />
                </Td>
              </tr>
            )
          })}
        </tbody>
      </Table>
    </>
  )
}
