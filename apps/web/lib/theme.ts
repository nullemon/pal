import { cookies } from 'next/headers'

export type Theme = 'dark' | 'light'

/**
 * Cookie written by the account settings server action (P4) and read on the client by
 * `components/shell/ThemeScript` before first paint. Values: "dark" | "light"; absent means
 * follow `prefers-color-scheme`.
 */
export const THEME_COOKIE = 'theme'

/**
 * Server-side reader for dynamic pages that need the theme (e.g. `/me/settings`). Do NOT
 * call it from the root layout or any shell that must prerender: `cookies()` makes the
 * route dynamic.
 */
export async function resolveTheme(): Promise<Theme> {
  const store = await cookies()
  return store.get(THEME_COOKIE)?.value === 'light' ? 'light' : 'dark'
}
