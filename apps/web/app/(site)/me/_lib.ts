import type { SessionUser } from '@palscans/core'
import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth'

/** Every /me page: signed in (else /login?return=path) and onboarded (else /onboarding). */
export const requireAccount = async (path: string): Promise<SessionUser> => {
  const user = await requireUser({ returnTo: path })
  if (!user.username) redirect(`/onboarding?return=${encodeURIComponent(path)}`)
  return user
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>

export const flatParams = async (sp: SearchParams): Promise<Record<string, string>> => {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(await sp)) if (typeof v === 'string') out[k] = v
  return out
}
