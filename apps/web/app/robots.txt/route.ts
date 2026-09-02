import { getEnv } from '@/lib/env'
import { robotsTxt } from '@/lib/seo/robots'
import { cachedSeoSettings } from '@/lib/seo/settings'

/** robots.txt from the editable setting, with the sitemap line and the AI-crawler preset. */
export async function GET() {
  const settings = await cachedSeoSettings()
  const origin = new URL(getEnv().SITE_URL).origin
  return new Response(robotsTxt(settings, origin), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=300',
    },
  })
}

/** Served per request (settings-driven); never prerendered at build time. */
export const dynamic = 'force-dynamic'
