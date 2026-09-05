import { adminMessages } from '@palscans/core/messages/admin'
import { getDb } from '@palscans/db'
import { CommentSettingsForm } from '@/components/admin/client/CommentSettingsForm'
import { loadFiltersAndAllowlist } from '@/components/admin/server/moderation'
import { PageHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'
import { loadCommentSettings } from '@/lib/comments/settings'

export default async function CommentSettingsPage() {
  await withPermission('settings.write', { returnTo: '/admin/comments/settings' })
  const db = await getDb()
  const [settings, lists] = await Promise.all([
    loadCommentSettings(db, 0),
    loadFiltersAndAllowlist(),
  ])
  const m = adminMessages.admin.moderation.settings
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <CommentSettingsForm initial={settings} filters={lists.filters} allowlist={lists.allowlist} />
    </>
  )
}
