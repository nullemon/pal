import { ThemeScreen } from '@/components/admin/client/ThemeScreen'
import { loadThemeScreen, workflowState } from '@/components/admin/server/appearance'
import { withPermission } from '@/lib/auth'

export default async function ThemePage() {
  await withPermission('settings.write', { returnTo: '/admin/appearance/theme' })
  const data = await loadThemeScreen()
  return (
    <ThemeScreen
      initial={data.draft?.doc ?? data.live}
      workflow={workflowState(data)}
      presets={data.presets}
    />
  )
}
