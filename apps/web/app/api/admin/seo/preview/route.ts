import { getDb } from '@palscans/db'
import { ok, parseJson, withPermission } from '@/lib/auth'
import { getEnv } from '@/lib/env'
import { previewSchema } from '@/lib/seo/admin'
import { previewTemplates } from '@/lib/seo/admin-data'
import { loadSeoSettings, type SeoTemplates } from '@/lib/seo/settings'

/** Live template preview against a real series (docs/12 §8). Unsaved templates are passed in. */
export const POST = withPermission('settings.write', async (request) => {
  const parsed = await parseJson(request, previewSchema)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  const settings = await loadSeoSettings(db)
  const templates: SeoTemplates = { ...settings.templates }
  for (const [page, t] of Object.entries(parsed.data.templates ?? {})) {
    if (t) templates[page as keyof SeoTemplates] = t
  }
  const origin = new URL(getEnv().SITE_URL).origin
  return ok(await previewTemplates(db, settings, templates, origin, parsed.data.slug))
})
