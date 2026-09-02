import { messages } from '@palscans/core/messages'
import { getDb, users } from '@palscans/db'
import { Avatar } from '@palscans/ui'
import { eq } from 'drizzle-orm'
import type { ReactNode } from 'react'
import { getSessionUser } from '@/lib/auth'
import { avatarUrl } from '@/lib/auth/media'
import { AccountNav } from './_components/AccountNav'
import { SignOutButton } from './_components/SignOutButton'

/**
 * Account shell: identity card + section nav (sidebar on desktop, scrolling tabs on
 * mobile). Pages do their own `requireAccount(path)` so the login redirect carries the
 * exact return path; this layout only decorates.
 */
export default async function MeLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser()
  let profile: { displayName: string | null; avatarKey: string | null } | undefined
  if (user) {
    const db = await getDb()
    ;[profile] = await db
      .select({ displayName: users.displayName, avatarKey: users.avatarKey })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1)
  }
  const name = profile?.displayName || user?.username || '?'
  return (
    <div className="container-page py-6 lg:py-8">
      <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
        <aside className="flex flex-col gap-4">
          {user ? (
            <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-1 p-3">
              <Avatar name={name} src={avatarUrl(profile?.avatarKey)} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-fg">{name}</p>
                <p className="truncate text-[12px] text-fg-muted">@{user.username ?? '—'}</p>
              </div>
              <SignOutButton className="hidden lg:inline-flex" />
            </div>
          ) : null}
          <AccountNav />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
      <span className="sr-only">{messages.me.title}</span>
    </div>
  )
}
