import { messages } from '@palscans/core/messages'
import type { Metadata } from 'next'
import { Hint, PageHeader, Panel, PanelHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'
import { BackupPanel } from './_components/BackupPanel'
import { readLastBackup } from './service'

/**
 * `Admin → System → Backup` (docs/17 §G): the button, the last run's outcome, and the two
 * things the button does *not* cover — object storage, and actually restoring the thing.
 *
 * Same permission as every other System screen (`settings.write`, admin-only per
 * `ROLE_PERMISSIONS`), and the same `withPermission` guard, so a signed-in non-admin gets a
 * 404 rather than a hint that the screen exists.
 */
export const metadata: Metadata = { title: messages.backup.title }
export const dynamic = 'force-dynamic'

export default async function AdminBackupPage() {
  await withPermission('settings.write', { returnTo: '/admin/system/backup' })
  const m = messages.backup
  const last = await readLastBackup()

  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <div className="mt-3.5 flex flex-col gap-3.5">
        <BackupPanel initial={last} />

        <Panel>
          <PanelHeader title={m.whatItDoes} hint={m.whatItDoesHint} />
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[13px] leading-5 text-fg-muted">
            <li>{m.step1}</li>
            <li>{m.step2}</li>
            <li>{m.step3}</li>
          </ol>
          <div className="mt-3.5 flex flex-col gap-1.5 border-t border-line-soft pt-3.5">
            <Hint>{m.restoreNote}</Hint>
            <Hint>{m.objectsNote}</Hint>
          </div>
        </Panel>
      </div>
    </>
  )
}
