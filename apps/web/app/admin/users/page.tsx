import { can } from '@palscans/core'
import { messages } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { Button } from '@palscans/ui'
import { z } from 'zod'
import { pageSchema, parseSearch, type SearchParams } from '@/components/admin/server/params'
import { loadUserList } from '@/components/admin/server/users'
import { inputClass, PageHeader, Pagination } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'
import { type UserRowView, UsersTable } from './UsersTable'

const schema = z.object({
  q: z.string().trim().max(120).optional(),
  page: pageSchema,
})

export default async function UsersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await withPermission('user.read', { returnTo: '/admin/users' })
  const p = parseSearch(schema, await searchParams)
  const { rows, pages } = await loadUserList(p.q, p.page)
  const m = adminMessages.admin.users
  const view: UserRowView[] = rows.map((u) => ({
    id: u.id,
    email: u.email,
    username: u.username,
    role: u.role,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    emailVerifiedAt: u.emailVerifiedAt?.toISOString() ?? null,
    commentBannedUntil: u.commentBannedUntil?.toISOString() ?? null,
    banned: !!u.banned,
  }))
  return (
    <>
      <PageHeader
        title={m.title}
        subtitle={m.subtitle}
        actions={
          can(actor, 'user.update') ? (
            <Button href="/admin/users/new" size="sm" className="h-9">
              {m.newUser}
            </Button>
          ) : null
        }
      />
      <form method="get" action="/admin/users" className="flex items-center gap-2">
        <input
          name="q"
          defaultValue={p.q ?? ''}
          placeholder={adminMessages.admin.search}
          className={`${inputClass} max-w-sm`}
        />
        <button
          type="submit"
          className="h-9 rounded-md border border-line bg-surface-1 px-3 text-[13px] font-semibold hover:bg-surface-2"
        >
          {messages.nav.search}
        </button>
      </form>
      <UsersTable
        rows={view}
        actorId={actor.id}
        query={p.q ?? ''}
        perms={{
          role: can(actor, 'user.role'),
          ban: can(actor, 'user.ban'),
          update: can(actor, 'user.update'),
        }}
      />
      <Pagination
        page={p.page}
        pages={pages}
        hrefFor={(n) => `/admin/users?${p.q ? `q=${encodeURIComponent(p.q)}&` : ''}page=${n}`}
      />
    </>
  )
}
