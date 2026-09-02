import { randomBytes } from 'node:crypto'
import * as OTPAuth from 'otpauth'
import QRCode from 'qrcode'

/** docs/07 / docs/13: optional TOTP for everyone, mandatory for `admin` (enforced by admin UI). */
export const TOTP_ISSUER = 'PALScans'

export const generateTotpSecret = (): string =>
  OTPAuth.Secret.fromHex(randomBytes(20).toString('hex')).base32

const totpFor = (secret: string, label: string) =>
  new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  })

export const totpUri = (secret: string, label: string): string => totpFor(secret, label).toString()

/** Accepts the current step and one step either side (clock drift). */
export const verifyTotp = (secret: string, code: string, label = 'account'): boolean => {
  const delta = totpFor(secret, label).validate({ token: code, window: 1 })
  return delta !== null
}

/** The otpauth URI as an SVG data URL — rendered with a plain <img>, never injected as HTML. */
export const totpQrDataUrl = async (uri: string): Promise<string> => {
  const svg = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
