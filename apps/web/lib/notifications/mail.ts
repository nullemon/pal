import type { FetchLike } from './types'

/**
 * The mailer shape the digest sends through.
 *
 * It is **structurally identical** to `@/lib/email`'s `Mailer`, so the web routes pass
 * `getMailer()` straight in and there is one mailer in the web app. The worker cannot import
 * that module — `lib/email/mailer.ts` uses extensionless relative imports, which the worker's
 * NodeNext resolution rejects — so `mailerFromEnv()` below gives the worker the same two
 * behaviours: log to the console, or send through Resend when `RESEND_API_KEY` is set.
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

export const resendMailer = (apiKey: string, fetchImpl: FetchLike = fetch): Mailer => ({
  kind: 'resend',
  async send(mail) {
    try {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: MAIL_FROM,
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

/** Console unless `RESEND_API_KEY` is set — the worker's mailer. */
export const mailerFromEnv = (source: Record<string, string | undefined> = process.env): Mailer => {
  const key = source.RESEND_API_KEY
  return key ? resendMailer(key) : consoleMailer()
}
