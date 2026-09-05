import { adminMessages } from '@palscans/core/messages/admin'
import { z } from 'zod'
import { diffJson, loadAuditLog } from '@/components/admin/server/audit-log'
import { pageSchema, parseSearch, type SearchParams } from '@/components/admin/server/params'
import {
  EmptyRow,
  inputClass,
  PageHeader,
  Pagination,
  Table,
  Td,
  Th,
  When,
} from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'

const schema = z.object({
  actor: z.string().trim().max(60).optional(),
  action: z.string().trim().max(60).optional(),
  target: z.string().trim().max(40).optional(),
  targetId: z.coerce.number().int().positive().optional().catch(undefined),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
  page: pageSchema,
})

export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await withPermission('audit.read', { returnTo: '/admin/audit' })
  const p = parseSearch(schema, await searchParams)
  const { rows, pages } = await loadAuditLog(p)
  const m = adminMessages.admin.audit
  const qs = (page: number) => {
    const u = new URLSearchParams()
    for (const [k, v] of Object.entries(p)) if (v !== undefined && k !== 'page') u.set(k, String(v))
    u.set('page', String(page))
    return `/admin/audit?${u.toString()}`
  }
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <form method="get" action="/admin/audit" className="flex flex-wrap items-center gap-2">
        <input
          name="actor"
          defaultValue={p.actor ?? ''}
          placeholder={m.actor}
          className={`${inputClass} w-36`}
        />
        <input
          name="action"
          defaultValue={p.action ?? ''}
          placeholder={m.action}
          className={`${inputClass} w-44`}
        />
        <input
          name="target"
          defaultValue={p.target ?? ''}
          placeholder={m.target}
          className={`${inputClass} w-32`}
        />
        <input
          name="targetId"
          defaultValue={p.targetId ?? ''}
          placeholder={adminMessages.admin.id}
          className={`${inputClass} w-24`}
        />
        <input
          name="from"
          type="date"
          defaultValue={p.from ?? ''}
          aria-label={m.from}
          className={`${inputClass} w-40`}
        />
        <input
          name="to"
          type="date"
          defaultValue={p.to ?? ''}
          aria-label={m.to}
          className={`${inputClass} w-40`}
        />
        <button
          type="submit"
          className="h-9 rounded-md border border-line bg-surface-1 px-3 text-[13px] font-semibold hover:bg-surface-2"
        >
          {adminMessages.admin.apply}
        </button>
      </form>
      <Table>
        <thead>
          <tr>
            <Th>{m.when}</Th>
            <Th>{m.actor}</Th>
            <Th>{m.action}</Th>
            <Th>{m.target}</Th>
            <Th>{m.diff}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <EmptyRow colSpan={5}>{m.empty}</EmptyRow> : null}
          {rows.map((r) => {
            const diff = diffJson(r.before, r.after)
            return (
              <tr key={r.id} className="align-top">
                <Td className="whitespace-nowrap text-fg-muted">
                  <When date={r.createdAt} />
                </Td>
                <Td>
                  {r.actor ? (
                    <a
                      href={`/admin/users/${r.actorId}`}
                      className="font-semibold hover:text-brand-hover"
                    >
                      {r.actor}
                    </a>
                  ) : (
                    <span className="text-fg-subtle">{m.system}</span>
                  )}
                </Td>
                <Td>
                  <code className="rounded-sm bg-surface-3 px-1 text-[12px]">{r.action}</code>
                </Td>
                <Td className="whitespace-nowrap text-fg-muted">
                  {r.targetType}
                  {r.targetId ? ` #${r.targetId}` : ''}
                </Td>
                <Td>
                  {diff.length === 0 ? (
                    <span className="text-[12px] text-fg-subtle">{m.noChange}</span>
                  ) : (
                    <details className="text-[12px]">
                      <summary className="cursor-pointer text-fg-muted">
                        {diff.length} {m.diff.toLowerCase()}
                      </summary>
                      <table className="mt-1 w-full max-w-xl">
                        <tbody>
                          {diff.slice(0, 40).map((d) => (
                            <tr key={d.path} className="align-top">
                              <td className="pr-2 font-mono text-fg-subtle">{d.path}</td>
                              <td className="max-w-[220px] break-words pr-2 font-mono text-danger line-through">
                                {d.before}
                              </td>
                              <td className="max-w-[220px] break-words font-mono text-ok">
                                {d.after}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  )}
                </Td>
              </tr>
            )
          })}
        </tbody>
      </Table>
      <Pagination page={p.page} pages={pages} hrefFor={qs} />
    </>
  )
}
