import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

/**
 * Sealing for operator-supplied credentials stored in the database (docs/19).
 *
 * The admin panel accepts R2 keys, OAuth secrets, a Stripe key and so on, which means those
 * values now live in Postgres rather than only in the deploy environment. They are sealed
 * with AES-256-GCM so a database dump — the thing most likely to leave the server — does not
 * hand someone the bucket.
 *
 * The key is derived from `CREDENTIALS_KEY`, falling back to `SESSION_SECRET`, so an existing
 * deployment needs no new variable. That fallback has a consequence worth stating plainly:
 * rotating `SESSION_SECRET` without setting `CREDENTIALS_KEY` first makes every stored
 * credential unreadable and they must be re-entered. `sealingKeySource()` reports which one
 * is in use so the panel can say so.
 */

const INFO = 'palscans:credentials:v1'
const NONCE_BYTES = 12
const TAG_BYTES = 16
const MIN_KEY_MATERIAL = 16

export class SealingKeyMissingError extends Error {
  constructor() {
    super('Set CREDENTIALS_KEY (or SESSION_SECRET) before storing credentials.')
    this.name = 'SealingKeyMissingError'
  }
}

/** Which environment variable the sealing key came from, for the panel to display. */
export const sealingKeySource = (
  source: NodeJS.ProcessEnv = process.env,
): 'CREDENTIALS_KEY' | 'SESSION_SECRET' | null => {
  const dedicated = source.CREDENTIALS_KEY?.trim() ?? ''
  if (dedicated.length >= MIN_KEY_MATERIAL) return 'CREDENTIALS_KEY'
  const session = source.SESSION_SECRET?.trim() ?? ''
  if (session.length >= MIN_KEY_MATERIAL && !session.startsWith('change-me'))
    return 'SESSION_SECRET'
  return null
}

const keyFor = (source: NodeJS.ProcessEnv): Buffer => {
  const which = sealingKeySource(source)
  if (!which) throw new SealingKeyMissingError()
  const material = (source[which] ?? '').trim()
  // A fixed salt is correct here: the input is already a high-entropy secret, and a random
  // per-row salt would have to be stored beside the ciphertext to no benefit.
  return Buffer.from(hkdfSync('sha256', material, 'palscans-credentials', INFO, 32))
}

/** Encrypt one value. Layout: nonce ‖ ciphertext ‖ tag. */
export const seal = (plaintext: string, source: NodeJS.ProcessEnv = process.env): Buffer => {
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv('aes-256-gcm', keyFor(source), nonce)
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([nonce, body, cipher.getAuthTag()])
}

/**
 * Decrypt one value, or null when it cannot be read — a truncated row, or a key that has
 * been rotated out from under it. Callers treat null as "not configured" and fall back to
 * the environment, so a rotated key degrades to the old behaviour instead of a crash.
 */
export const open = (
  sealed: Uint8Array,
  source: NodeJS.ProcessEnv = process.env,
): string | null => {
  if (sealed.byteLength <= NONCE_BYTES + TAG_BYTES) return null
  try {
    const buf = Buffer.from(sealed)
    const decipher = createDecipheriv('aes-256-gcm', keyFor(source), buf.subarray(0, NONCE_BYTES))
    decipher.setAuthTag(buf.subarray(buf.length - TAG_BYTES))
    return Buffer.concat([
      decipher.update(buf.subarray(NONCE_BYTES, buf.length - TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    return null
  }
}

/** Constant-time compare, for verifying a webhook secret the operator stored. */
export const secretEquals = (a: string, b: string): boolean => {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  return left.length === right.length && timingSafeEqual(left, right)
}
