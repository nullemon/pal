import { adminMessages } from '@palscans/core/messages/admin'
import { getDb, getSetting } from '@palscans/db'
import { AdsForm } from '@/components/admin/client/AdsForm'
import { AD_SLOTS, type AdsSetting } from '@/components/admin/schemas-system'
import { PageHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'

export default async function AdsPage() {
  await withPermission('settings.write', { returnTo: '/admin/ads' })
  const raw = await getSetting<{
    slots?: Record<string, { enabled?: unknown; tag?: unknown }>
    ads_txt?: unknown
  }>(await getDb(), 'ads', {})
  const initial: AdsSetting = {
    slots: Object.fromEntries(
      AD_SLOTS.map((s) => [
        s,
        {
          enabled: raw.slots?.[s]?.enabled !== false,
          tag: typeof raw.slots?.[s]?.tag === 'string' ? (raw.slots[s]?.tag as string) : null,
        },
      ]),
    ) as AdsSetting['slots'],
    ads_txt: typeof raw.ads_txt === 'string' ? raw.ads_txt : '',
  }
  const m = adminMessages.admin.ads
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <AdsForm initial={initial} />
    </>
  )
}
