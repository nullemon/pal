import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * The Turnstile **success** path, exercised over real HTTP.
 *
 * Everything else about bot protection was already proven by the callers' own suites: a
 * missing token is refused on register, login, comments and the DMCA form. What was never
 * executed is the branch that lets a *real human* through — `res.json()` on a real response
 * and `json.success === true` — because this sandbox cannot reach
 * `challenges.cloudflare.com`. That branch runs on every signup, so "probably fine" is not
 * good enough for it.
 *
 * So this suite stands up a local server that answers like Cloudflare's siteverify and drives
 * `verifyTurnstile` at it through the `fetchImpl` parameter the function already takes. The
 * forwarder asserts the URL the production code built is Cloudflare's, then replays the
 * request verbatim — same method, same headers, same body — at the local server. Nothing in
 * `turnstile.ts` is stubbed or skipped: the request shape, the JSON round-trip and the
 * success/failure branches are all the real ones.
 *
 * Deliberately **not** done: making the siteverify URL configurable from the environment.
 * That would be a supported way to point verification at a host that answers `success: true`
 * to everything, i.e. an env var that turns bot protection off. The injection seam already
 * present is enough to test with, and it cannot be reached from a deployment.
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const SECRET = '0x4AAAAAAADeadBeefSecretKey'
const GOOD_TOKEN = '0.valid-token-from-a-real-widget'
const BAD_TOKEN = '0.token-that-was-tampered-with'

const state = vi.hoisted(() => ({ secret: '' as string, unreadable: false }))

/**
 * The registration gate below reads two operator settings out of the database. Nothing in
 * this suite is about the database, so it answers "no rows" and the gate falls back to its
 * own defaults — registration open, Turnstile on — which is the configuration a launched
 * site runs in and the one where a broken success path breaks every signup.
 */
vi.mock('@palscans/db', () => ({
  getDb: async () => ({}),
  getSetting: async <T>(_db: unknown, _key: string, fallback: T) => fallback,
  inviteCodes: {},
  settings: {},
}))

vi.mock('../config/store', () => ({
  resolveConfig: async () => ({
    values: {
      'bot.turnstile_site_key': '1x00000000000000000000AA',
      'bot.turnstile_secret_key': state.secret,
    },
    sources: {},
  }),
  credentialUnreadable: async (_id: string) => state.unreadable,
}))

const { verifyTurnstile, turnstileEnabled } = await import('./turnstile')

/** What the local siteverify saw, so the request the code really sends can be asserted. */
interface Seen {
  method: string
  contentType: string | undefined
  body: { secret?: string; response?: string; remoteip?: string }
}
let seen: Seen[] = []

/** Stands in for Cloudflare, with Cloudflare's contract: same fields, same error codes. */
const siteverify = createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', (c: Buffer) => chunks.push(c))
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8')
    let body: Seen['body'] = {}
    try {
      body = JSON.parse(raw) as Seen['body']
    } catch {
      /* recorded below as an empty body */
    }
    seen.push({
      method: req.method ?? '',
      contentType: req.headers['content-type'],
      body,
    })
    const send = (status: number, payload: unknown) => {
      const text = JSON.stringify(payload)
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(text)
    }
    if (req.url !== '/turnstile/v0/siteverify') return send(404, { success: false })
    if (body.secret !== SECRET)
      return send(200, { success: false, 'error-codes': ['invalid-input-secret'] })
    if (body.response === GOOD_TOKEN)
      return send(200, {
        success: true,
        challenge_ts: new Date().toISOString(),
        hostname: 'palscans.test',
        action: 'register',
      })
    return send(200, { success: false, 'error-codes': ['invalid-input-response'] })
  })
})

let base = ''
/** A port with nothing on it: bound, its number taken, then released. */
let deadPort = 0

beforeAll(async () => {
  await new Promise<void>((resolve) => siteverify.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(siteverify.address() as AddressInfo).port}`
  const scratch: Server = createServer()
  await new Promise<void>((resolve) => scratch.listen(0, '127.0.0.1', resolve))
  deadPort = (scratch.address() as AddressInfo).port
  await new Promise<void>((resolve) => scratch.close(() => resolve()))
})

afterAll(async () => {
  await new Promise<void>((resolve) => siteverify.close(() => resolve()))
})

afterEach(() => {
  seen = []
  state.secret = ''
  state.unreadable = false
})

/** The URL production built, captured so the test can prove it is Cloudflare's. */
let requestedUrl: string | null = null

/**
 * A `fetch` that replays the production request at `target` unchanged. It rewrites only the
 * host — the method, headers and body are the ones `verifyTurnstile` produced.
 */
const forwardTo = (target: string): typeof fetch =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrl =
      typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const path = new URL(requestedUrl).pathname
    return globalThis.fetch(`${target}${path}`, init)
  }) as typeof fetch

describe('verifyTurnstile against a real siteverify server', () => {
  it('is only enforced once a secret is configured', async () => {
    expect(await turnstileEnabled()).toBe(false)
    state.secret = SECRET
    expect(await turnstileEnabled()).toBe(true)
  })

  // --- outcome 1: a valid token is allowed through --------------------------
  it('lets a valid token through, and sends Cloudflare the request it expects', async () => {
    state.secret = SECRET
    const ok = await verifyTurnstile(GOOD_TOKEN, forwardTo(base))

    expect(ok).toBe(true)
    // The production code must be talking to Cloudflare, not somewhere else.
    expect(requestedUrl).toBe(SITEVERIFY_URL)
    // And the server must have received a request siteverify would actually accept.
    expect(seen).toHaveLength(1)
    expect(seen[0]?.method).toBe('POST')
    expect(seen[0]?.contentType).toBe('application/json')
    expect(seen[0]?.body).toEqual({ secret: SECRET, response: GOOD_TOKEN })
  })

  it('never sends the visitor address to Cloudflare, even though siteverify accepts one', () => {
    // `remoteip` is optional, and this site does not hand a reader's address to anything it
    // does not have to. The route handlers have no address to pass any more either.
    expect('remoteip' in (seen[0]?.body ?? {})).toBe(false)
  })

  // --- outcome 2: an invalid token is refused -------------------------------
  it('refuses a token siteverify rejects', async () => {
    state.secret = SECRET
    expect(await verifyTurnstile(BAD_TOKEN, forwardTo(base))).toBe(false)
    expect(seen[0]?.body.response).toBe(BAD_TOKEN)
  })

  it('refuses when the secret itself is wrong, rather than passing the request', async () => {
    state.secret = 'not-the-configured-secret'
    expect(await verifyTurnstile(GOOD_TOKEN, forwardTo(base))).toBe(false)
  })

  it('refuses a missing token without asking siteverify at all', async () => {
    state.secret = SECRET
    expect(await verifyTurnstile(undefined, forwardTo(base))).toBe(false)
    expect(await verifyTurnstile('', forwardTo(base))).toBe(false)
    expect(seen).toHaveLength(0)
  })

  // --- outcome 3: siteverify unreachable ------------------------------------
  it('FAILS CLOSED when siteverify cannot be reached', async () => {
    state.secret = SECRET
    // Nothing is listening on this port, so the fetch rejects with ECONNREFUSED.
    const refused = await verifyTurnstile(GOOD_TOKEN, forwardTo(`http://127.0.0.1:${deadPort}`))
    // A Cloudflare outage therefore blocks signups; it does not wave bots through.
    expect(refused).toBe(false)
    expect(seen).toHaveLength(0)
  })

  it('fails closed when siteverify answers with something that is not JSON', async () => {
    state.secret = SECRET
    const garbage = createServer((_req, res) => {
      res.writeHead(502, { 'content-type': 'text/html' })
      res.end('<html>502 Bad Gateway</html>')
    })
    await new Promise<void>((resolve) => garbage.listen(0, '127.0.0.1', resolve))
    const port = (garbage.address() as AddressInfo).port
    try {
      const base502 = `http://127.0.0.1:${port}`
      expect(await verifyTurnstile(GOOD_TOKEN, forwardTo(base502))).toBe(false)
    } finally {
      await new Promise<void>((resolve) => garbage.close(() => resolve()))
    }
  })

  // --- the branches that decide whether to verify at all --------------------
  it('passes everything when no secret is configured, so local dev needs no Cloudflare', async () => {
    state.secret = ''
    expect(await verifyTurnstile(undefined, forwardTo(base))).toBe(true)
    expect(seen).toHaveLength(0)
  })

  it('fails closed when the stored secret is present but will not decrypt', async () => {
    state.secret = ''
    state.unreadable = true
    expect(await verifyTurnstile(GOOD_TOKEN, forwardTo(base))).toBe(false)
    expect(seen).toHaveLength(0)
  })

  // --- the default fetch, i.e. what production actually uses ----------------
  it('uses the global fetch when no fetch is injected', async () => {
    state.secret = SECRET
    const real = globalThis.fetch
    const spy = vi.fn(forwardTo(base))
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      // Only the siteverify call is redirected; the forwarder's own hop uses the real fetch.
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url
      if (url.startsWith('https://challenges.cloudflare.com')) return spy(input, init)
      return real(input, init)
    }) as typeof fetch
    try {
      expect(await verifyTurnstile(GOOD_TOKEN)).toBe(true)
    } finally {
      globalThis.fetch = real
    }
    expect(spy).toHaveBeenCalledOnce()
    expect(requestedUrl).toBe(SITEVERIFY_URL)
    expect(seen[0]?.body.remoteip).toBeUndefined()
  })
})

/**
 * The same success path one level up, through the gate the register route actually calls.
 * `verifyTurnstile` returning true is only useful if a real registration then proceeds, and
 * this is the call whose failure would mean nobody can sign up.
 */
describe('the registration gate with Turnstile enforced', () => {
  /** Redirect only the siteverify call; everything else keeps the real fetch. */
  const withSiteverifyAt = async <T>(target: string, fn: () => Promise<T>): Promise<T> => {
    const real = globalThis.fetch
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url
      if (url.startsWith('https://challenges.cloudflare.com')) {
        requestedUrl = url
        return real(`${target}${new URL(url).pathname}`, init)
      }
      return real(input, init)
    }) as typeof fetch
    try {
      return await fn()
    } finally {
      globalThis.fetch = real
    }
  }

  it('admits a real human holding a valid token', async () => {
    state.secret = SECRET
    const { checkRegistrationAccess } = await import('./invites')
    const gate = await withSiteverifyAt(base, () =>
      checkRegistrationAccess({
        email: 'reader@example.com',
        turnstileToken: GOOD_TOKEN,
        ip: '203.0.113.7',
      }),
    )
    expect(gate.ok).toBe(true)
    expect(requestedUrl).toBe(SITEVERIFY_URL)
    expect(seen[0]?.body).toEqual({ secret: SECRET, response: GOOD_TOKEN })
  })

  it('turns away a registration whose token siteverify rejects', async () => {
    state.secret = SECRET
    const { checkRegistrationAccess } = await import('./invites')
    const gate = await withSiteverifyAt(base, () =>
      checkRegistrationAccess({
        email: 'bot@example.com',
        turnstileToken: BAD_TOKEN,
        ip: '203.0.113.9',
      }),
    )
    expect(gate.ok).toBe(false)
    expect(gate.ok === false && gate.error).toBe('turnstile')
    expect(gate.ok === false && gate.status).toBe(400)
  })
})
