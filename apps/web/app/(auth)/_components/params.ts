import { z } from 'zod'
import { safeReturnPath } from '@/lib/auth/return-to'

/** Query parameters the auth pages accept; everything else is dropped. */
export const authParamsSchema = z.object({
  return: z.string().optional(),
  gate: z.enum(['premium']).optional(),
  link: z.enum(['google', 'discord']).optional(),
  email: z.string().email().optional(),
  error: z.enum(['oauth_failed', 'oauth_unavailable', 'oauth_no_email']).optional(),
  provider: z.enum(['google', 'discord']).optional(),
  linked: z.enum(['google', 'discord']).optional(),
  reset: z.string().optional(),
  token: z.string().optional(),
  sent: z.string().optional(),
})

export type AuthParams = z.infer<typeof authParamsSchema>

export const readAuthParams = (raw: Record<string, string | string[] | undefined>): AuthParams => {
  const flat: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') flat[k] = v
  const parsed = authParamsSchema.safeParse(flat)
  const data = parsed.success ? parsed.data : {}
  return { ...data, return: safeReturnPath(data.return) }
}

export const providerName = (p: 'google' | 'discord' | undefined): string =>
  p === 'google' ? 'Google' : p === 'discord' ? 'Discord' : ''
