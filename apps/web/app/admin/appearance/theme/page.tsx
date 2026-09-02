import { ThemeScreen } from '@/components/admin/client/ThemeScreen'
import { loadThemeScreen } from '@/components/admin/server/appearance'
import { DEFAULT_APPEARANCE } from '@/lib/appearance/schema'
import { withPermission } from '@/lib/auth'

export default async function ThemePage() {
  await withPermission('settings.write', { returnTo: '/admin/appearance/theme' })
  const data = await loadThemeScreen()
  const initial = data.draft?.doc ?? data.published?.doc ?? DEFAULT_APPEARANCE
  return (
    <ThemeScreen
      initial={initial}
      hasDraft={!!data.draft}
      published={
        data.published
          ? {
              id: data.published.id,
              publishedAt: data.published.publishedAt,
              by: data.published.by,
            }
          : null
      }
      versions={data.versions}
      presets={data.presets}
    />
  )
}
