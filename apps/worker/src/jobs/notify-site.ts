import { z } from 'zod'

/**
 * The site identity the notification senders put in links, embeds and mail (docs/17 §D).
 *
 * `apps/web/lib/env.ts` cannot be reused here: it asserts things about a *web server* (an
 * https origin, a declared proxy) that mean nothing to a background process, and it would
 * refuse to start the worker. These three values are all the worker needs, so it parses them
 * itself with the same defaults the web app uses.
 */
const siteSchema = z.object({
  SITE_URL: z.string().url().default('http://localhost:3000'),
  SITE_NAME: z.string().min(1).default('PALScans'),
  PUBLIC_CDN_URL: z.string().url().optional(),
})

export interface WorkerSite {
  siteUrl: string
  siteName: string
  cdnUrl: string | null
}

export const workerSite = (source: Record<string, string | undefined> = process.env): WorkerSite => {
  const clean: Record<string, string> = {}
  for (const [k, v] of Object.entries(source)) if (v !== undefined && v !== '') clean[k] = v
  const env = siteSchema.parse(clean)
  return { siteUrl: env.SITE_URL, siteName: env.SITE_NAME, cdnUrl: env.PUBLIC_CDN_URL ?? null }
}
