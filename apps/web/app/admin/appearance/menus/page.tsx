import { adminMessages } from '@palscans/core/messages/admin'
import { getDb, getSetting } from '@palscans/db'
import { MenusScreen } from '@/components/admin/client/MenusScreen'
import { PageHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'
import { menusFromChrome } from '@/lib/chrome/form'
import { siteChromeFresh } from '@/lib/chrome/load'
import { menusSettingSchema } from '@/lib/chrome/schema'

/**
 * Appearance → Header, footer, menus (docs/15).
 *
 * The form is seeded from the *resolved* chrome rather than the raw row, so an operator whose
 * site has never been configured opens the screen on the links the site is actually showing
 * and edits from there — instead of an empty form that would wipe the footer on first save.
 */
export default async function MenusPage() {
  await withPermission('settings.write', { returnTo: '/admin/appearance/menus' })
  const raw = await getSetting<Record<string, unknown>>(await getDb(), 'menus', {})
  const stored = menusSettingSchema.safeParse(raw)
  const initial = stored.success ? stored.data : menusFromChrome(await siteChromeFresh(), raw)
  const m = adminMessages.menus
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <MenusScreen initial={initial} />
    </>
  )
}
