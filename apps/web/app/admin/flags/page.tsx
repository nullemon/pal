import { adminMessages } from '@palscans/core/messages/admin'
import { featureFlags, getDb } from '@palscans/db'
import { isNull } from 'drizzle-orm'
import { FlagsTable } from '@/components/admin/client/FlagsTable'
import { PageHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'

export default async function FlagsPage() {
  await withPermission('settings.write', { returnTo: '/admin/flags' })
  const rows = await (await getDb())
    .select()
    .from(featureFlags)
    .where(isNull(featureFlags.deletedAt))
    .orderBy(featureFlags.key)
  const m = adminMessages.admin.settings.flags
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <FlagsTable
        initial={rows.map((r) => ({
          key: r.key,
          enabled: r.enabled as 'off' | 'on' | 'percentage',
          percentage: r.percentage,
          description: r.description,
        }))}
      />
    </>
  )
}
