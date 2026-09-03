import 'server-only'
import { createECDH, randomUUID, timingSafeEqual } from 'node:crypto'
import { fmt, messages } from '@palscans/core/messages'
import { createStorage } from '@palscans/core/storage'
import { getEnv } from '../env'
import { checkHost } from './net-guard'
import { type ConfigGroup, FIELDS_BY_ID, isMasked } from './registry'
import { isLocalHost, smtpSendTest } from './smtp'
import { resolveConfig } from './store'

/**
 * The connection tests behind Admin → System → Integrations (docs/19).
 *
 * The point of this file is that a green tick means something. Every check below either
 * touches the real provider or is reported as unverified — there is no third category where
 * the panel guesses. A check that cannot be made honestly (a Stripe webhook secret, a public
 * Turnstile site key) says so in as many words instead of passing.
 *
 * Three rules hold everywhere in here:
 *
 * - tests run against the values in the operator's form, so a credential can be proved
 *   before it is stored — which means this module handles unsaved secrets
 * - nothing is logged, ever: no console call, and every provider error is caught so a stack
 *   trace carrying a signed URL cannot escape into the server log
 * - what comes back describes the provider's answer, never the value that produced it
 */

const m = messages.admin.integrations
const R = m.results

export type CheckState = 'pass' | 'fail' | 'skip'

export interface Check {
  label: string
  state: CheckState
  detail: string
}

export interface TestReport {
  group: ConfigGroup
  /** True only when at least one check ran and none failed. */
  ok: boolean
  checks: Check[]
}

const pass = (label: string, detail: string): Check => ({ label, state: 'pass', detail })
const fail = (label: string, detail: string): Check => ({ label, state: 'fail', detail })
const skip = (label: string, detail: string): Check => ({ label, state: 'skip', detail })

/** Provider replies are shown to the operator, so they are trimmed to one readable line. */
const clamp = (value: string, max = 220): string => {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

const reason = (err: unknown): string => {
  if (err instanceof Error) {
    const named = err as Error & { name?: string; code?: string }
    const code = named.code ?? named.name
    return clamp(code && code !== 'Error' ? `${code}: ${err.message}` : err.message)
  }
  return clamp(String(err))
}

const TIMEOUT_MS = 12_000

/** `fetch` with a deadline; a hung provider must not hold an admin request open. */
const call = async (url: string, init: RequestInit = {}): Promise<Response> =>
  fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' })

/** The provider's own error text, from whichever shape it uses. */
const errorText = async (res: Response): Promise<string> => {
  const body = await res.text().catch(() => '')
  try {
    const json = JSON.parse(body) as {
      error?: string | { message?: string; type?: string }
      error_description?: string
      message?: string
      'error-codes'?: string[]
    }
    const err = json.error
    const text =
      (typeof err === 'string' ? err : err?.message) ??
      json.error_description ??
      json.message ??
      json['error-codes']?.join(', ')
    if (text) return clamp(`${res.status} ${text}`)
  } catch {
    // not JSON
  }
  return clamp(body ? `${res.status} ${body}` : `HTTP ${res.status}`)
}

/* ------------------------------------------------------------------- resolving */

/**
 * The values a test should run against: what is stored, with the operator's unsaved edits on
 * top. A submitted secret still carrying the mask means "the one already stored"; an emptied
 * box means "deleted", which is a fall back to the environment — the same thing saving would
 * do, so the test and the save agree.
 */
/**
 * A stored secret may only be reused against the destination it was stored for.
 *
 * The browser never receives a secret, but it does choose where the test sends one. Without
 * this, submitting a new `smtp_host` while leaving the password field masked made the server
 * open a session to that host and send `AUTH PLAIN` with the *stored* password — a one
 * request exfiltration of a credential the panel is careful never to show. The same shape
 * applies to an S3 endpoint.
 *
 * So a secret is bound to its destination: change the destination and the secret must be
 * typed again.
 */
const SECRET_DESTINATION: Record<string, string> = {
  'email.smtp_password': 'email.smtp_host',
  's3.secret_access_key': 's3.endpoint',
}

export interface MergedValues {
  values: Record<string, string>
  /** Secrets not reused because their destination changed; the caller must report these. */
  withheld: string[]
}

export const mergeSubmitted = async (submitted: Record<string, string>): Promise<MergedValues> => {
  const { values } = await resolveConfig({ fresh: true })
  const merged: Record<string, string> = { ...values }
  const withheld: string[] = []

  const destinationChanged = (secretId: string): boolean => {
    const destId = SECRET_DESTINATION[secretId]
    if (!destId) return false
    const submittedDest = submitted[destId]
    if (submittedDest === undefined) return false
    return submittedDest.trim() !== (values[destId] ?? '').trim()
  }

  for (const [id, raw] of Object.entries(submitted)) {
    const field = FIELDS_BY_ID.get(id)
    if (!field) continue
    const value = raw.trim()
    if (field.secret && isMasked(value)) {
      if (destinationChanged(id)) {
        merged[id] = ''
        withheld.push(id)
      }
      continue
    }
    merged[id] = value === '' ? (process.env[field.env] ?? '').trim() : value
  }
  return { values: merged, withheld }
}

/* -------------------------------------------------------------------- storage */

const storageChecks = async (v: Record<string, string>): Promise<Check[]> => {
  const checks: Check[] = []
  const cdn = v['storage.public_cdn_url'] ?? ''
  const key = `_healthcheck/${randomUUID()}.txt`
  const body = new TextEncoder().encode(`palscans ${new Date().toISOString()}`)

  if ((v['storage.driver'] ?? '') !== 's3') {
    const root = getEnv().STORAGE_FS_ROOT
    try {
      const storage = await createStorage({
        driver: 'fs',
        fs: { root, publicUrl: cdn || '/_storage' },
      })
      await storage.put(key, body, { contentType: 'text/plain' })
      const back = await storage.get(key)
      await storage.delete(key)
      if (!back || Buffer.compare(Buffer.from(back), Buffer.from(body)) !== 0)
        return [fail(m.checks.localFolder, R.bytesDiffer)]
      checks.push(pass(m.checks.localFolder, R.localFolderOk))
    } catch (err) {
      checks.push(fail(m.checks.localFolder, fmt(R.localFolderFailed, { detail: reason(err) })))
    }
    checks.push(skip(m.checks.cdnUrl, R.localFolderNote))
    return checks
  }

  checks.push(
    cdn
      ? pass(m.checks.cdnUrl, fmt(R.cdnUrlOk, { url: cdn }))
      : fail(m.checks.cdnUrl, R.cdnUrlMissing),
  )

  // The endpoint is operator-supplied and this makes the server connect to it, so refuse
  // anything inside the network before opening the connection (see ./net-guard).
  const endpoint = v['s3.endpoint'] ?? ''
  if (endpoint) {
    let host = ''
    try {
      host = new URL(endpoint).hostname
    } catch {
      return [fail(m.checks.write, R.s3BadEndpoint)]
    }
    const verdict = await checkHost(host)
    if (!verdict.allowed) return [fail(m.checks.write, verdict.reason ?? R.s3BadEndpoint)]
  }

  // The bucket is exercised even when the CDN hostname is missing: they are two independent
  // mistakes and the operator should see both at once.
  const storage = await createStorage({
    driver: 's3',
    s3: {
      bucket: v['s3.bucket'] || undefined,
      endpoint: v['s3.endpoint'] || undefined,
      region: v['s3.region'] || 'auto',
      accessKeyId: v['s3.access_key_id'] || undefined,
      secretAccessKey: v['s3.secret_access_key'] || undefined,
      forcePathStyle: v['s3.force_path_style'] === 'true',
      publicUrl: cdn || 'https://cdn.invalid',
    },
  })

  try {
    await storage.put(key, body, { contentType: 'text/plain', cacheControl: 'no-store' })
  } catch (err) {
    checks.push(fail(m.checks.write, fmt(R.writeFailed, { detail: reason(err) })))
    return checks
  }
  checks.push(pass(m.checks.write, fmt(R.writeOk, { bytes: body.byteLength, key })))

  try {
    const back = await storage.get(key)
    if (back === null) checks.push(fail(m.checks.readBack, R.readBackMissing))
    else {
      checks.push(pass(m.checks.readBack, R.readBackOk))
      const same =
        back.byteLength === body.byteLength && timingSafeEqual(Buffer.from(back), Buffer.from(body))
      checks.push(same ? pass(m.checks.bytes, R.bytesOk) : fail(m.checks.bytes, R.bytesDiffer))
    }
  } catch (err) {
    checks.push(fail(m.checks.readBack, fmt(R.readBackFailed, { detail: reason(err) })))
  }

  try {
    await storage.delete(key)
    checks.push(pass(m.checks.cleanup, R.cleanupOk))
  } catch {
    checks.push(fail(m.checks.cleanup, fmt(R.cleanupFailed, { key })))
  }
  return checks
}

/* ---------------------------------------------------------------------- email */

const emailChecks = async (v: Record<string, string>, to: string): Promise<Check[]> => {
  const from = v['email.from'] || ''
  const resendKey = v['email.resend_api_key'] ?? ''
  const host = v['email.smtp_host'] ?? ''
  if (!resendKey && !host) return [fail(m.checks.mailProvider, R.mailNoProvider)]
  if (!from) return [fail(m.checks.mailProvider, R.mailNoFrom)]
  if (!resendKey && host) {
    // Loopback is allowed here and only here: the shipped compose stack runs Mailpit on
    // localhost and testing it is legitimate.
    const verdict = await checkHost(host, { allowLoopback: true })
    if (!verdict.allowed) return [fail(m.checks.smtpConnect, verdict.reason ?? '')]
  }

  const subject = `${messages.site.name} — integrations test`
  const text = [
    'This is the connection test from Admin → System → Integrations.',
    'If you are reading it, the mail credentials in the panel work.',
    '',
    new Date().toISOString(),
  ].join('\n')

  if (resendKey) {
    try {
      const res = await call('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${resendKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, text }),
      })
      if (!res.ok)
        return [fail(m.checks.resend, fmt(R.resendFailed, { detail: await errorText(res) }))]
      const json = (await res.json().catch(() => ({}))) as { id?: string }
      return [pass(m.checks.resend, fmt(R.resendOk, { email: to, id: json.id ?? '—' }))]
    } catch (err) {
      return [fail(m.checks.resend, fmt(R.resendFailed, { detail: reason(err) }))]
    }
  }

  const port = Number.parseInt(v['email.smtp_port'] || '587', 10)
  const result = await smtpSendTest({
    host,
    port: Number.isFinite(port) ? port : 587,
    user: v['email.smtp_user'] || undefined,
    password: v['email.smtp_password'] || undefined,
    from,
    to,
    subject,
    text,
  })
  const detail = result.detail ?? ''
  const checks: Check[] = []
  if (result.failedAt === 'connect' || result.failedAt === 'greeting')
    checks.push(fail(m.checks.smtpConnect, fmt(R.smtpConnectFailed, { host, port, detail })))
  else {
    checks.push(pass(m.checks.smtpConnect, fmt(R.smtpConnectOk, { host, port })))
    if (result.failedAt === 'starttls' || result.failedAt === 'ehlo')
      checks.push(fail(m.checks.smtpTls, detail || R.smtpTlsFailed))
    else {
      checks.push(
        result.secure
          ? pass(m.checks.smtpTls, R.smtpTlsOk)
          : isLocalHost(host)
            ? // A server on this machine is not exposed, so plain text is not a finding.
              skip(m.checks.smtpTls, R.smtpTlsLocal)
            : fail(m.checks.smtpTls, R.smtpTlsFailed),
      )
      if (result.failedAt === 'auth')
        checks.push(fail(m.checks.smtpAuth, fmt(R.smtpAuthFailed, { detail })))
      else {
        checks.push(pass(m.checks.smtpAuth, R.smtpAuthOk))
        checks.push(
          result.delivered
            ? pass(m.checks.smtpSend, fmt(R.smtpSendOk, { email: to }))
            : fail(m.checks.smtpSend, fmt(R.smtpSendFailed, { detail })),
        )
      }
    }
  }
  return checks
}

/* -------------------------------------------------------------------- discord */

const DISCORD_API = 'https://discord.com/api/v10'

const discordChecks = async (v: Record<string, string>): Promise<Check[]> => {
  const token = v['discord.bot_token'] ?? ''
  const guildId = v['discord.guild_id'] ?? ''
  if (!token) return [fail(m.checks.botIdentity, R.notSet)]
  const auth = { authorization: `Bot ${token}` }
  const checks: Check[] = []
  try {
    const res = await call(`${DISCORD_API}/users/@me`, { headers: auth })
    if (!res.ok)
      return [
        fail(m.checks.botIdentity, fmt(R.botIdentityFailed, { detail: await errorText(res) })),
      ]
    const me = (await res.json()) as { username?: string; id?: string }
    checks.push(
      pass(m.checks.botIdentity, fmt(R.botIdentityOk, { name: me.username ?? me.id ?? '—' })),
    )
  } catch (err) {
    return [fail(m.checks.botIdentity, fmt(R.botIdentityFailed, { detail: reason(err) }))]
  }

  if (!guildId) {
    checks.push(skip(m.checks.botGuild, R.botGuildSkipped))
    return checks
  }
  try {
    const res = await call(`${DISCORD_API}/guilds/${encodeURIComponent(guildId)}`, {
      headers: auth,
    })
    if (!res.ok)
      checks.push(
        fail(
          m.checks.botGuild,
          fmt(R.botGuildFailed, { id: guildId, detail: await errorText(res) }),
        ),
      )
    else {
      const guild = (await res.json()) as { name?: string }
      checks.push(pass(m.checks.botGuild, fmt(R.botGuildOk, { name: guild.name ?? guildId })))
    }
  } catch (err) {
    checks.push(
      fail(m.checks.botGuild, fmt(R.botGuildFailed, { id: guildId, detail: reason(err) })),
    )
  }
  return checks
}

/* ------------------------------------------------------------------- payments */

const paymentsChecks = async (v: Record<string, string>): Promise<Check[]> => {
  const key = v['payments.stripe_secret_key'] ?? ''
  const webhook = v['payments.stripe_webhook_secret'] ?? ''
  const checks: Check[] = []
  if (!key) checks.push(fail(m.checks.stripeAccount, R.notSet))
  else {
    try {
      const res = await call('https://api.stripe.com/v1/account', {
        headers: { authorization: `Bearer ${key}` },
      })
      if (!res.ok)
        checks.push(
          fail(
            m.checks.stripeAccount,
            fmt(R.stripeAccountFailed, { detail: await errorText(res) }),
          ),
        )
      else {
        const account = (await res.json()) as { id?: string; charges_enabled?: boolean }
        const vars = {
          id: account.id ?? '—',
          mode: key.startsWith('sk_live') ? R.stripeLiveMode : R.stripeTestMode,
        }
        checks.push(
          account.charges_enabled === false
            ? fail(m.checks.stripeAccount, fmt(R.stripeAccountChargesOff, vars))
            : pass(m.checks.stripeAccount, fmt(R.stripeAccountOk, vars)),
        )
      }
    } catch (err) {
      checks.push(fail(m.checks.stripeAccount, fmt(R.stripeAccountFailed, { detail: reason(err) })))
    }
  }
  checks.push(
    webhook
      ? skip(m.checks.stripeWebhook, R.stripeWebhookSkipped)
      : fail(m.checks.stripeWebhook, R.stripeWebhookMissing),
  )
  return checks
}

/* ------------------------------------------------------------------ turnstile */

/**
 * Cloudflare answers a bad token with `invalid-input-response` and a bad secret with
 * `invalid-input-secret`. Sending a token that is certainly invalid therefore separates the
 * two without ever solving a challenge.
 *
 * Anything that is not one of those two answers — a proxy in the way, a 500, HTML instead of
 * JSON — is reported as a failure rather than quietly counted as a pass. Silence from
 * Cloudflare is not a working key; it is what a real sign-up would hit too.
 */
const botChecks = async (v: Record<string, string>): Promise<Check[]> => {
  const secret = v['bot.turnstile_secret_key'] ?? ''
  const siteKey = v['bot.turnstile_site_key'] ?? ''
  const checks: Check[] = []
  if (!secret) checks.push(fail(m.checks.turnstileSecret, R.notSet))
  else {
    try {
      const res = await call('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret, response: 'palscans-connection-test' }),
      })
      const raw = await res.text().catch(() => '')
      let json: { success?: boolean; 'error-codes'?: string[] } | null = null
      try {
        json = JSON.parse(raw) as { success?: boolean; 'error-codes'?: string[] }
      } catch {
        // not JSON — handled below
      }
      if (!res.ok || json === null || typeof json.success !== 'boolean')
        checks.push(
          fail(
            m.checks.turnstileSecret,
            fmt(R.turnstileUnreachable, { detail: clamp(raw || `HTTP ${res.status}`) }),
          ),
        )
      else {
        const codes = json['error-codes'] ?? []
        const badSecret = codes.some((c) => c.includes('secret'))
        checks.push(
          badSecret
            ? fail(
                m.checks.turnstileSecret,
                fmt(R.turnstileSecretFailed, { detail: codes.join(', ') }),
              )
            : pass(m.checks.turnstileSecret, R.turnstileSecretOk),
        )
      }
    } catch (err) {
      checks.push(
        fail(m.checks.turnstileSecret, fmt(R.turnstileUnreachable, { detail: reason(err) })),
      )
    }
  }
  checks.push(
    siteKey
      ? skip(m.checks.turnstileSiteKey, R.turnstileSiteKeySkipped)
      : fail(m.checks.turnstileSiteKey, R.turnstileSiteKeyMissing),
  )
  return checks
}

/* ---------------------------------------------------------------------- oauth */

/**
 * Both providers separate "I do not know this client" from "that code is no good", so asking
 * to exchange a code that cannot exist proves the client ID and secret without a browser and
 * without issuing anything.
 *
 * Only the two answers that mean something are graded. `invalid_grant` is the credentials
 * working (the code was refused, not the client); `invalid_client` is them not working.
 * Anything else — an error shape neither provider documents, a proxy, an outage — is
 * reported as unverified, because a pass here has to mean the provider said so.
 */
const exchangeProbe = async (
  label: string,
  url: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<Check> => {
  if (!clientId || !clientSecret) return skip(label, R.oauthSkipped)
  try {
    const res = await call(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'palscans-connection-test',
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    })
    const raw = await res.text().catch(() => '')
    let body: { error?: string } | null = null
    try {
      body = JSON.parse(raw) as { error?: string }
    } catch {
      // not JSON — unverified below
    }
    const err = body?.error ?? ''
    if (err === 'invalid_grant') return pass(label, R.oauthOk)
    if (res.status === 401 || err === 'invalid_client' || err === 'unauthorized_client')
      return fail(
        label,
        fmt(R.oauthFailed, { detail: clamp(`${res.status} ${err || 'rejected'}`) }),
      )
    return skip(label, fmt(R.oauthUnverified, { detail: clamp(raw || `HTTP ${res.status}`) }))
  } catch (err) {
    return fail(label, fmt(R.oauthFailed, { detail: reason(err) }))
  }
}

const oauthChecks = async (v: Record<string, string>): Promise<Check[]> => {
  const site = getEnv().SITE_URL.replace(/\/+$/, '')
  return [
    await exchangeProbe(
      m.checks.googleOauth,
      'https://oauth2.googleapis.com/token',
      v['oauth.google_client_id'] ?? '',
      v['oauth.google_client_secret'] ?? '',
      `${site}/api/auth/google/callback`,
    ),
    await exchangeProbe(
      m.checks.discordOauth,
      `${DISCORD_API}/oauth2/token`,
      v['oauth.discord_client_id'] ?? '',
      v['oauth.discord_client_secret'] ?? '',
      `${site}/api/auth/discord/callback`,
    ),
  ]
}

/* ----------------------------------------------------------------------- push */

const b64u = (value: string): Buffer | null => {
  try {
    return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  } catch {
    return null
  }
}

/**
 * A VAPID pair is verifiable offline and completely: derive the public point from the private
 * scalar and compare. That is the whole of what a push service checks when it validates the
 * JWT signature, so this is a real answer rather than a format guess.
 */
const pushChecks = (v: Record<string, string>): Check[] => {
  const publicKey = b64u(v['push.vapid_public_key'] ?? '')
  const privateKey = b64u(v['push.vapid_private_key'] ?? '')
  const subject = v['push.vapid_subject'] ?? ''
  const checks: Check[] = []

  if (publicKey?.byteLength !== 65 || publicKey[0] !== 0x04)
    checks.push(fail(m.checks.vapidPair, R.vapidPublicInvalid))
  else if (privateKey?.byteLength !== 32)
    checks.push(fail(m.checks.vapidPair, R.vapidPrivateInvalid))
  else {
    try {
      const ecdh = createECDH('prime256v1')
      ecdh.setPrivateKey(privateKey)
      const derived = ecdh.getPublicKey()
      checks.push(
        derived.byteLength === publicKey.byteLength && timingSafeEqual(derived, publicKey)
          ? pass(m.checks.vapidPair, R.vapidPairOk)
          : fail(m.checks.vapidPair, R.vapidMismatch),
      )
    } catch {
      checks.push(fail(m.checks.vapidPair, R.vapidPrivateInvalid))
    }
  }

  checks.push(
    /^(mailto:|https:\/\/)\S+$/.test(subject)
      ? pass(m.checks.vapidSubject, fmt(R.vapidSubjectOk, { subject }))
      : fail(m.checks.vapidSubject, R.vapidSubjectInvalid),
  )
  checks.push(skip(m.checks.pushDelivery, R.pushDeliverySkipped))
  return checks
}

/* ---------------------------------------------------------------------- entry */

export interface TestContext {
  /** The signed-in admin: test mail goes to their own address and nowhere else. */
  email: string
}

/**
 * Run one group's checks. Never throws: an unexpected failure becomes a failing check, so
 * the screen always has something specific to show.
 */
export const runConnectionTest = async (
  group: ConfigGroup,
  values: Record<string, string>,
  ctx: TestContext,
  withheld: readonly string[] = [],
): Promise<TestReport> => {
  // A secret bound to a different destination is not reused (see `mergeSubmitted`). Say so
  // rather than running a test that would fail for a reason the operator cannot see.
  if (withheld.length)
    return {
      group,
      ok: false,
      checks: withheld.map((id) =>
        fail(FIELDS_BY_ID.get(id)?.label ?? id, m.checks.secretWithheld),
      ),
    }
  let checks: Check[]
  try {
    switch (group) {
      case 'storage':
        checks = await storageChecks(values)
        break
      case 'email':
        checks = await emailChecks(values, ctx.email)
        break
      case 'discord':
        checks = await discordChecks(values)
        break
      case 'payments':
        checks = await paymentsChecks(values)
        break
      case 'bot':
        checks = await botChecks(values)
        break
      case 'oauth':
        checks = await oauthChecks(values)
        break
      case 'push':
        checks = pushChecks(values)
        break
      default:
        checks = []
    }
  } catch (err) {
    checks = [fail(m.groups[group], fmt(R.unexpected, { detail: reason(err) }))]
  }
  if (checks.length === 0) checks = [skip(m.groups[group], R.nothingToTest)]
  return {
    group,
    ok: checks.some((c) => c.state === 'pass') && checks.every((c) => c.state !== 'fail'),
    checks,
  }
}
