import { randomBytes } from 'node:crypto'
import { open, seal } from '@palscans/core'
import { getDb, users } from '@palscans/db'
import { and, eq, isNull, lt, or } from 'drizzle-orm'
import * as OTPAuth from 'otpauth'
import QRCode from 'qrcode'

/** docs/07 / docs/13: optional TOTP for everyone, mandatory for `admin` (enforced by admin UI). */
export const TOTP_ISSUER = 'PALScans'

/** RFC 6238 time step, in seconds. A "step" below is a count of these since the epoch. */
export const TOTP_PERIOD_SEC = 30

export const generateTotpSecret = (): string =>
  OTPAuth.Secret.fromHex(randomBytes(20).toString('hex')).base32

const totpFor = (secret: string, label: string) =>
  new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: TOTP_PERIOD_SEC,
    secret: OTPAuth.Secret.fromBase32(secret),
  })

export const totpUri = (secret: string, label: string): string => totpFor(secret, label).toString()

/** The otpauth URI as an SVG data URL — rendered with a plain <img>, never injected as HTML. */
export const totpQrDataUrl = async (uri: string): Promise<string> => {
  const svg = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

// ---------------------------------------------------------------- the secret at rest

/**
 * The enrolled secret has two homes (migration 9036): `totp_secret_sealed`, AES-256-GCM
 * under `CREDENTIALS_KEY`, which is what everything writes now; and `totp_secret`, raw
 * base32, which is what rows enrolled before 9036 still hold. This resolves either.
 *
 * `null` means "cannot be used as a second factor", and it covers three different things on
 * purpose: not enrolled, and a sealed value that will not open (a rotated sealing key, a
 * truncated row). **Callers must not treat that as "no second factor required"** — branch on
 * `totpEnabledAt`, which says whether the account is enrolled, and let the code check fail.
 * The other way round fails open: an unreadable secret would turn the panel's mandatory
 * second factor off for exactly the accounts that have one.
 */
export const totpSecretOf = (row: {
  totpSecret: string | null
  totpSecretSealed: Uint8Array | null
}): string | null => (row.totpSecretSealed ? open(row.totpSecretSealed) : row.totpSecret)

/**
 * The columns to write when storing a freshly generated secret. Always sealed; the plaintext
 * column is cleared in the same statement so enrolment can never leave one behind.
 *
 * `seal` throws `SealingKeyMissingError` when neither `CREDENTIALS_KEY` nor a real
 * `SESSION_SECRET` is set, exactly as storing a panel credential does (`lib/config/store.ts`)
 * — production cannot boot in that state (`lib/env.ts`), and a development box that has not
 * set a secret gets the same refusal for both, rather than a second factor that only looks
 * protected. Callers catch it and answer with `messages.me.security.sealingUnavailable`.
 */
export const totpSecretColumns = (
  secret: string,
): { totpSecret: null; totpSecretSealed: Uint8Array } => ({
  totpSecret: null,
  totpSecretSealed: seal(secret),
})

// ------------------------------------------------------------------- verifying a code

/**
 * The absolute 30-second step a code is valid for, or null when it is not valid at all.
 * The current step and one either side are accepted, which is the drift allowance TOTP
 * deployments need; the *replay* half of that window is handled by `consumeTotp`.
 */
export const totpStepFor = (
  secret: string,
  code: string,
  label = 'account',
  now: number = Date.now(),
): number | null => {
  const delta = totpFor(secret, label).validate({ token: code, window: 1, timestamp: now })
  if (delta === null) return null
  return Math.floor(now / 1000 / TOTP_PERIOD_SEC) + delta
}

/**
 * The replay rule on its own, so it can be reasoned about and tested without a database:
 * a step is acceptable once, and never one at or below a step already spent.
 */
export const totpStepIsFresh = (step: number | null, lastStep: number | null): boolean =>
  step !== null && (lastStep === null || step > lastStep)

/**
 * Verify a code **and spend it**: true only for a correct code whose step this account has
 * not used before. Every place that checks a TOTP code goes through here.
 *
 * The claim is a single conditional UPDATE rather than a read-then-write, so two requests
 * arriving with the same code — the natural shape of a replay, and of a double-submitted
 * form — cannot both be told yes: exactly one row is updated and the loser gets `false`.
 *
 * A row still holding a pre-9036 plaintext secret is re-sealed in the same statement, which
 * is the whole migration path for existing enrolments: no operator action, no lockout, and
 * the plaintext column empties itself as enrolled accounts sign in. Re-sealing is best
 * effort — if there is no sealing key the code check still stands on its own.
 */
export const consumeTotp = async (
  userId: number,
  row: { totpSecret: string | null; totpSecretSealed: Uint8Array | null },
  code: string,
  label = 'account',
  now: number = Date.now(),
): Promise<boolean> => {
  const secret = totpSecretOf(row)
  if (!secret) return false
  const step = totpStepFor(secret, code, label, now)
  if (step === null) return false

  const set: { totpLastStep: number; totpSecret?: null; totpSecretSealed?: Uint8Array } = {
    totpLastStep: step,
  }
  if (!row.totpSecretSealed) {
    try {
      Object.assign(set, totpSecretColumns(secret))
    } catch {
      // No sealing key: leave the legacy column alone rather than failing the sign-in.
    }
  }

  const db = await getDb()
  const claimed = await db
    .update(users)
    .set(set)
    .where(and(eq(users.id, userId), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
    .returning({ id: users.id })
  return claimed.length > 0
}
