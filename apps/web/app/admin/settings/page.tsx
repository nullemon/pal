import { messages } from '@palscans/core/messages'
import { getDb, getSetting } from '@palscans/db'
import { SettingsForm } from '@/components/admin/client/SettingsForm'
import { type SiteSetting, siteSettingSchema } from '@/components/admin/schemas-system'
import { PageHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'

export default async function SettingsPage() {
  await withPermission('settings.write', { returnTo: '/admin/settings' })
  const raw = await getSetting<Record<string, unknown>>(await getDb(), 'site', {})
  const parsed = siteSettingSchema.safeParse({
    name: raw.name ?? 'PALScans',
    tagline: raw.tagline ?? '',
    url: raw.url ?? 'https://palscans.org',
    discord_url: raw.discord_url ?? '',
    registration: raw.registration ?? 'open',
    maintenance: raw.maintenance ?? { enabled: false, eta: null },
  })
  const initial: SiteSetting = parsed.success
    ? parsed.data
    : {
        name: 'PALScans',
        tagline: '',
        url: 'https://palscans.org',
        discord_url: '',
        registration: 'open',
        maintenance: { enabled: false, eta: null },
      }
  const m = messages.admin.settings
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <SettingsForm initial={initial} />
    </>
  )
}
