/**
 * `?return=` deep links: only same-origin paths are honoured, never protocol-relative
 * (`//evil`) or absolute URLs, and never the auth pages themselves (a loop).
 */
export const AUTH_PATHS = [
  '/login',
  '/register',
  '/verify',
  '/forgot-password',
  '/reset-password',
  '/onboarding',
  '/logout',
]

export const safeReturnPath = (value: string | null | undefined, fallback = '/'): string => {
  if (!value || typeof value !== 'string') return fallback
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback
  // Every C0 control and DEL, not just CR/LF/NUL: the URL parser silently strips TAB, so
  // `/\t/evil.example.com` parses as an absolute URL and the redirect leaves the site.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point — they are what has to be rejected
  if (/[\u0000-\u001f\u007f]/.test(value) || value.length > 2000) return fallback
  const path = value.split(/[?#]/)[0] ?? value
  if (AUTH_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) return fallback
  if (path.startsWith('/api/')) return fallback
  return value
}

/** Append `return` to an auth page href when it is not the default. */
export const withReturn = (
  href: string,
  returnTo: string | undefined,
  extra?: Record<string, string>,
) => {
  const params = new URLSearchParams(extra)
  if (returnTo && returnTo !== '/') params.set('return', returnTo)
  const qs = params.toString()
  return qs ? `${href}?${qs}` : href
}
