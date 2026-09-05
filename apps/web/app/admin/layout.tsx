import { adminMessages } from '@palscans/core/messages/admin'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { AdminShell } from '@/components/admin/AdminShell'
import { withPermission } from '@/lib/auth'
import { findUserById } from '@/lib/auth/users'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: adminMessages.admin.title,
  robots: { index: false, follow: false },
}

/**
 * docs/04: the whole panel sits behind `can(user, 'admin.access')`; docs/07: TOTP is
 * mandatory for the admin role, so an admin without it is sent to enable it first.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await withPermission('admin.access', { returnTo: '/admin' })
  if (user.role === 'admin') {
    const row = await findUserById(user.id)
    if (!row?.totpEnabledAt) redirect('/me/security?totp=required')
  }
  return <AdminShell user={user}>{children}</AdminShell>
}
