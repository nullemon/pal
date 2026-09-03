import { credentialValues } from '@palscans/core'
import { smtpSendTest } from '../config/smtp'
import type { FetchLike } from './types'

/**
 * The mailer shape the digest sends through.
 *
 * It is **structurally identical** to `@/lib/email`'s `Mailer`, so the web routes pass
 * `getMailer()` straight in and there is one mailer in the web app. The worker cannot import
 * that module — it reaches the store through `server-only` code the worker has no runtime for
 * — so `resolveMailer()` below gives the worker the same three behaviours from the same
 * resolved settings: Resend, SMTP, or the console.
 */
export interface Mail {
  to: string
  subject: string
  text: string
  html?: string
}

export interface MailResult {
  ok: boolean
  id?: string
  error?: string
}

export interface Mailer {
  readonly kind: string
  send(mail: Mail): Promise<MailResult>
}

export const MAIL_FROM = 'PALScans <no-reply@palscans.org>'

export const consoleMailer = (
  log: (line: string) => void = (line) => console.info(line),
): Mailer => ({
  kind: 'console',
  async send(mail) {
    log(`[mail] ${mail.subject} → ${mail.to}\n${mail.text}`)
    return { ok: true, id: `console-${Date.now()}` }
  },
})

export const resendMailer = (
  apiKey: string,
  fetchImpl: FetchLike = fetch,
  from: string = MAIL_FROM,
): Mailer => ({
  kind: 'resend',
  async send(mail) {
    try {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from,
          to: [mail.to],
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
        }),
      })
      if (!res.ok) return { ok: false, error: `resend ${res.status}` }
      const json = (await res.json().catch(() => ({}))) as { id?: string }
      return { ok: true, id: json.id }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'send failed' }
    }
  },
})

/** SMTP through the same dependency-free client the connection test and the web app use. */
export const smtpMailer = (
  smtp: { host: string; port: number; user?: string; password?: string },
  from: string = MAIL_FROM,
): Mailer => ({
  kind: 'smtp',
  async send(mail) {
    try {
      const result = await smtpSendTest({
        ...smtp,
        from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
      })
      if (result.ok) return { ok: true }
      return {
        ok: false,
        error: `smtp ${result.failedAt ?? 'send'}: ${result.detail ?? ''}`.trim(),
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'send failed' }
    }
  },
})

/** Console unless `RESEND_API_KEY` is set — the worker's mailer, environment only. */
export const mailerFromEnv = (source: Record<string, string | undefined> = process.env): Mailer => {
  const key = source.RESEND_API_KEY
  return key ? resendMailer(key, fetch, source.EMAIL_FROM || MAIL_FROM) : consoleMailer()
}

/**
 * The worker's mailer, from the operator's stored settings with the environment behind them
 * (docs/19). Same precedence and same transports as `@/lib/email`'s `getMailer()`, so a
 * digest and a verification mail leave by the same route; the credential slot is filled in by
 * `apps/worker/src/lib/config.ts` and by the web app's `instrumentation.ts`.
 */
export const resolveMailer = async (): Promise<Mailer> => {
  const v = await credentialValues({
    apiKey: ['email.resend_api_key', 'RESEND_API_KEY'],
    from: ['email.from', 'EMAIL_FROM'],
    host: ['email.smtp_host', 'SMTP_HOST'],
    port: ['email.smtp_port', 'SMTP_PORT'],
    user: ['email.smtp_user', 'SMTP_USER'],
    password: ['email.smtp_password', 'SMTP_PASSWORD'],
  })
  const from = v.from || MAIL_FROM
  if (v.apiKey) return resendMailer(v.apiKey, fetch, from)
  if (!v.host) return consoleMailer()
  const port = Number.parseInt(v.port, 10)
  return smtpMailer(
    {
      host: v.host,
      port: Number.isFinite(port) && port > 0 ? port : 587,
      user: v.user || undefined,
      password: v.password || undefined,
    },
    from,
  )
}
