import { createHash } from 'node:crypto'
import { getEnv, isLoopbackHttp } from '../env'

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
  readonly kind: 'console' | 'resend' | 'none'
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

/**
 * Production without a provider: never print a reset / verification link to stdout (it would
 * land in the log aggregator). Logs a hashed recipient and the subject, and fails the send so
 * the route can answer 503.
 */
export class NoopMailer implements Mailer {
  readonly kind = 'none' as const
  constructor(private readonly log: (line: string) => void = (line) => console.warn(line)) {}
  async send(mail: Mail) {
    const to = createHash('sha256').update(mail.to.toLowerCase()).digest('hex').slice(0, 12)
    this.log(`[mail] no provider configured ${JSON.stringify({ subject: mail.subject, to })}`)
    return { ok: false, error: 'no_mail_provider' }
  }
}

let shared: Mailer | undefined

export const getMailer = (): Mailer => {
  if (shared) return shared
  const env = getEnv()
  // Production never prints a link to stdout — except a production build started on an
  // explicit loopback SITE_URL (env.ts refuses the default there): that is a local
  // verification run (`next start -p …`), where the console is the mailbox.
  shared = env.RESEND_API_KEY
    ? new ResendMailer(env.RESEND_API_KEY)
    : env.NODE_ENV === 'production' && !isLoopbackHttp(env.SITE_URL)
      ? new NoopMailer()
      : new ConsoleMailer()
  return shared
}

/** Tests: swap the process-wide mailer. */
export const setMailer = (mailer: Mailer | undefined): void => {
  shared = mailer
}
