import { getEnv } from '../env'

/**
 * Mailer abstraction (docs/16): logs to the console locally, sends through Resend when
 * RESEND_API_KEY is set. Templates live in ./templates.ts; the queue job `email.send` can
 * route through the same interface from the worker.
 */
export interface Mail {
  to: string
  subject: string
  text: string
  html?: string
}

export interface Mailer {
  readonly kind: 'console' | 'resend'
  send(mail: Mail): Promise<{ ok: boolean; id?: string; error?: string }>
}

export const MAIL_FROM = 'PALScans <no-reply@palscans.org>'

export class ConsoleMailer implements Mailer {
  readonly kind = 'console' as const
  constructor(private readonly log: (line: string) => void = (line) => console.info(line)) {}
  async send(mail: Mail) {
    this.log(
      [
        '',
        '┌─ [mail] ─────────────────────────────────────────',
        `│ to:      ${mail.to}`,
        `│ subject: ${mail.subject}`,
        '├──────────────────────────────────────────────────',
        ...mail.text.split('\n').map((l) => `│ ${l}`),
        '└──────────────────────────────────────────────────',
      ].join('\n'),
    )
    return { ok: true, id: `console-${Date.now()}` }
  }
}

export class ResendMailer implements Mailer {
  readonly kind = 'resend' as const
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async send(mail: Mail) {
    try {
      const res = await this.fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
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
  }
}

let shared: Mailer | undefined

export const getMailer = (): Mailer => {
  if (shared) return shared
  const key = getEnv().RESEND_API_KEY
  shared = key ? new ResendMailer(key) : new ConsoleMailer()
  return shared
}

/** Tests: swap the process-wide mailer. */
export const setMailer = (mailer: Mailer | undefined): void => {
  shared = mailer
}
