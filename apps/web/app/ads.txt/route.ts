import { getDb, getSetting } from '@palscans/db'

export const revalidate = 300

/** /ads.txt — served verbatim from Business → Ads (`settings.ads.ads_txt`). */
export async function GET(): Promise<Response> {
  let body = ''
  try {
    const ads = await getSetting<{ ads_txt?: unknown }>(await getDb(), 'ads', {})
    body = typeof ads.ads_txt === 'string' ? ads.ads_txt : ''
  } catch {
    body = ''
  }
  return new Response(body.endsWith('\n') || body === '' ? body : `${body}\n`, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  })
}
