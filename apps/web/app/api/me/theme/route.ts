import { cookies } from 'next/headers'
import { ok, parseJson, requireUser } from '@/lib/auth'
import { themeSchema } from '@/lib/auth/schemas'
import { secureCookies } from '@/lib/auth/session'
import { THEME_COOKIE } from '@/lib/theme'

/**
 * POST /api/me/theme {theme: dark|light|system} — writes the cookie `ThemeScript` reads
 * before paint (lib/theme.ts); `system` removes it so prefers-color-scheme applies.
 */
export const POST = requireUser(async (request) => {
  const parsed = await parseJson(request, themeSchema)
  if (!parsed.ok) return parsed.response
  const store = await cookies()
  const base = { path: '/', sameSite: 'lax' as const, secure: secureCookies() }
  if (parsed.data.theme === 'system') store.set(THEME_COOKIE, '', { ...base, maxAge: 0 })
  else store.set(THEME_COOKIE, parsed.data.theme, { ...base, maxAge: 365 * 86400 })
  return ok({ theme: parsed.data.theme })
})
