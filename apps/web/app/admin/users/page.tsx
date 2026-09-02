import { messages } from '@palscans/core/messages'
import { z } from 'zod'
import { pageSchema, parseSearch, type SearchParams } from '@/components/admin/server/params'
import { loadUserList } from '@/components/admin/server/users'
import {
  EmptyRow,
  inputClass,
  PageHeader,
  Pagination,
  Pill,
  Table,
  Td,
  Th,
  When,
} from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'

const schema = z.object({
  q: z.string().trim().max(120).optional(),
  page: pageSchema,
})

export default async function UsersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await withPermission('user.read', { returnTo: '/admin/users' })
  const p = parseSearch(schema, await searchParams)
  const { rows, pages } = await loadUserList(p.q, p.page)
  const m = messages.admin.users
  const now = new Date()
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <form method="get" action="/admin/users" className="flex items-center gap-2">
        <input
          name="q"
          defaultValue={p.q ?? ''}
          placeholder={messages.admin.search}
          className={`${inputClass} max-w-sm`}
        />
        <button
          type="submit"
          className="h-9 rounded-md border border-line bg-surface-1 px-3 text-[13px] font-semibold hover:bg-surface-2"
        >
          {messages.nav.search}
        </button>
      </form>
      <Table>
        <thead>
          <tr>
            <Th>{m.colUser}</Th>
            <Th>{m.colRole}</Th>
            <Th>{m.colStatus}</Th>
            <Th align="right">{m.colJoined}</Th>
            <Th align="right">{m.colLastLogin}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <EmptyRow colSpan={5}>{m.empty}</EmptyRow> : null}
          {rows.map((u) => (
            <tr key={u.id} className="hover:bg-surface-2/60">
              <Td>
                <a href={`/admin/users/${u.id}`} className="block">
                  <span className="block font-semibold hover:text-brand-hover">
                    {u.username ?? `#${u.id}`}
                  </span>
                  <span className="block text-[12px] text-fg-subtle">{u.email}</span>
                </a>
              </Td>
              <Td>
                <Pill
                  tone={
                    u.role === 'admin'
                      ? 'brand'
                      : u.role === 'moderator' || u.role === 'uploader'
                        ? 'gold'
                        : 'neutral'
                  }
                >
                  {u.role}
                </Pill>
              </Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  {u.banned ? <Pill tone="danger">{m.banned}</Pill> : null}
                  {u.commentBannedUntil && u.commentBannedUntil > now ? (
                    <Pill tone="warn">{m.commentBanned}</Pill>
                  ) : null}
                  {!u.emailVerifiedAt ? <Pill>{m.unverified}</Pill> : null}
                </div>
              </Td>
              <Td align="right" className="text-fg-muted">
                <When date={u.createdAt} />
              </Td>
              <Td align="right" className="text-fg-muted">
                <When date={u.lastLoginAt} />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Pagination
        page={p.page}
        pages={pages}
        hrefFor={(n) => `/admin/users?${p.q ? `q=${encodeURIComponent(p.q)}&` : ''}page=${n}`}
      />
    </>
  )
}
