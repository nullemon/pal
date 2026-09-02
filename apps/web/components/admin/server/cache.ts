import { revalidatePath, revalidateTag } from 'next/cache'

/**
 * Cache purges after admin saves (docs/04 "Saving writes the setting, purges the HTML
 * cache"). Tags match what the site agents use: `settings` (layouts/ads/menus),
 * `catalog` (series/chapters), `appearance` (the resolved token block in <head>).
 */
export const purgeSettings = (): void => {
  revalidateTag('settings', 'max')
  revalidatePath('/', 'layout')
}

export const purgeCatalog = (): void => {
  revalidateTag('catalog', 'max')
  revalidatePath('/', 'layout')
}

export const purgeAppearance = (): void => {
  revalidateTag('appearance', 'max')
  revalidatePath('/', 'layout')
}
