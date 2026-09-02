import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { AdminShell } from '@/components/admin/AdminShell'
import { withPermission } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
}

/** docs/04: the whole panel sits behind `can(user, 'admin.access')`. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await withPermission('admin.access', { returnTo: '/admin' })
  return <AdminShell user={user}>{children}</AdminShell>
}
