/**
 * IndexNow submission (docs/12 §5): one POST with the changed URLs to api.indexnow.org, which
 * fans out to Bing, Yandex, Naver, Seznam and Yep. The key file is served at `/<key>.txt`
 * by proxy.ts. Never throws — the sitemap build records the response in its log.
 */
export interface IndexNowResult {
  submitted: number
  status: number | null
  ok: boolean
  error?: string
}

export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow'
export const INDEXNOW_MAX_URLS = 10_000

export async function submitIndexNow(opts: {
  siteUrl: string
  key: string
  urls: readonly string[]
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): Promise<IndexNowResult> {
  const urls = [...new Set(opts.urls)].slice(0, INDEXNOW_MAX_URLS)
  if (urls.length === 0 || !opts.key) return { submitted: 0, status: null, ok: true }
  const origin = new URL(opts.siteUrl)
  const body = {
    host: origin.host,
    key: opts.key,
    keyLocation: `${origin.origin}/${opts.key}.txt`,
    urlList: urls,
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000)
  try {
    const res = await (opts.fetchImpl ?? fetch)(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    // 200 OK and 202 Accepted (key pending validation) both count as delivered.
    return {
      submitted: urls.length,
      status: res.status,
      ok: res.status === 200 || res.status === 202,
    }
  } catch (err) {
    return {
      submitted: urls.length,
      status: null,
      ok: false,
      error: err instanceof Error ? err.message : 'request failed',
    }
  } finally {
    clearTimeout(timer)
  }
}

export const generateIndexNowKey = (): string => {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
