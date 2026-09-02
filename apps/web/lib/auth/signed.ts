import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { getEnv } from '../env'

/**
 * Short-lived HMAC-signed values for cookies that must survive a redirect but never be
 * forged: OAuth state + PKCE verifier, the pending account-link, the MFA challenge.
 * Format: base64url(json).base64url(hmac-sha256(json)).
 */
const b64 = (buf: Buffer) => buf.toString('base64url')

const sign = (payload: string, secret: string) =>
  b64(createHmac('sha256', secret).update(payload).digest())

export const signValue = (value: unknown, secret: string = getEnv().SESSION_SECRET): string => {
  const payload = b64(Buffer.from(JSON.stringify(value), 'utf8'))
  return `${payload}.${sign(payload, secret)}`
}

const envelope = z.object({ exp: z.number().int() }).passthrough()

export const verifyValue = <T>(
  raw: string | undefined,
  schema: z.ZodType<T>,
  secret: string = getEnv().SESSION_SECRET,
  now: number = Date.now(),
): T | null => {
  if (!raw) return null
  const dot = raw.lastIndexOf('.')
  if (dot <= 0) return null
  const payload = raw.slice(0, dot)
  const mac = raw.slice(dot + 1)
  const expected = sign(payload, secret)
  if (mac.length !== expected.length) return null
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null
  let json: unknown
  try {
    json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  const env = envelope.safeParse(json)
  if (!env.success || env.data.exp < now) return null
  const parsed = schema.safeParse(json)
  return parsed.success ? parsed.data : null
}
