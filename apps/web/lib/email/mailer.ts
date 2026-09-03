import { createHash } from 'node:crypto'
import { resolveConfig } from '../config/store'
import { getEnv, isLoopbackHttp } from '../env'
import { smtpMailer } from '../notifications/mail'

/**
 * Mailer abstraction (docs/16): logs to the console locally, sends through Resend when a
 * Resend API key is set. Templates live in ./templates.ts; the queue job `email.send` can
 * route through the same interface from the worker.
 *
 * Every setting comes from the admin panel first and the environment second (docs/19), so an
 * operator can paste a Resend key — or an SMTP host — into Admin → System → Integrations and
 * have the next verification mail go out without a redeploy.
 *
 * Which transport is used follows the registry's own wording: a Resend API key wins, an SMTP
 * host is the alternative, and with neither the mailer behaves exactly as it did before —
 * console in development, an honest refusal in production. SMTP goes through
 * `lib/config/smtp.ts`, the same dependency-free client the connection test uses, so there
 * is one implementation of the protocol and a green tick on that screen means the real
 * transport works. It sends `text` only: no HTML alternative, which every template here
 * already provides for.
 */
export interface Mail {
  to: string
  subject: string
  text: string
  html?: string
}

export interface Mailer {
  readonly kind: 'console' | 'resend' | 'smtp' | 'none'
  send(mail: Mail): Promise<{ ok: boolean; id?: string; error?: string }>
}

/** The From address when neither the panel nor `EMAIL_FROM` supplies one. */
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
    private readonly from: string = MAIL_FROM,
  ) {}
  async send(mail: Mail) {
    try {
      const res = await this.fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: this.from,
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

export interface SmtpSettings {
  host: string
  port: number
  user?: string
  password?: string
}

/**
 * SMTP. The transport itself is `lib/notifications/mail.ts`'s `smtpMailer`, over
 * `lib/config/smtp.ts` — one implementation of the protocol for the whole platform, the one
 * the connection test proves, and the one the worker sends digests through. This is only the
 * adapter that narrows its `kind` to this module's union.
 *
 * A refused step comes back as `{ ok: false, error }` naming which one, never as a throw: the
 * routes answer 503 on a failed send and must not turn a wrong password into a 500.
 */
export class SmtpMailer implements Mailer {
  readonly kind = 'smtp' as const
  private readonly inner: { send(mail: Mail): Promise<{ ok: boolean; error?: string }> }
  constructor(smtp: SmtpSettings, from: string = MAIL_FROM) {
    this.inner = smtpMailer(smtp, from)
  }
  send(mail: Mail) {
    return this.inner.send(mail)
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

export const DEFAULT_SMTP_PORT = 587

export interface MailerSettings {
  apiKey: string
  from: string
  smtp: SmtpSettings | null
}

/** The mail settings, panel first and environment second (docs/19). */
export const mailerSettings = async (): Promise<MailerSettings> => {
  const { values } = await resolveConfig()
  const host = (values['email.smtp_host'] ?? '').trim()
  const port = Number.parseInt(values['email.smtp_port'] || '', 10)
  return {
    apiKey: values['email.resend_api_key'] ?? '',
    from: values['email.from'] || MAIL_FROM,
    smtp: host
      ? {
          host,
          port: Number.isFinite(port) && port > 0 ? port : DEFAULT_SMTP_PORT,
          user: values['email.smtp_user'] || undefined,
          password: values['email.smtp_password'] || undefined,
        }
      : null,
  }
}

/** Which transport the settings select, without building it. */
export const mailerKindFor = (settings: MailerSettings, env = getEnv()): Mailer['kind'] => {
  if (settings.apiKey) return 'resend'
  if (settings.smtp) return 'smtp'
  // Production never prints a link to stdout — except a production build started on an
  // explicit loopback SITE_URL (env.ts refuses the default there): that is a local
  // verification run (`next start -p …`), where the console is the mailbox.
  return env.NODE_ENV === 'production' && !isLoopbackHttp(env.SITE_URL) ? 'none' : 'console'
}

let override: Mailer | undefined
let shared: Mailer | undefined
let sharedFingerprint: string | undefined

/**
 * The process-wide mailer, rebuilt when the resolved settings change so a key saved in the
 * panel takes effect on the next send rather than the next restart. The fingerprint carries
 * the secrets by length and last characters only, so it is safe to hold and to log.
 */
export const getMailer = async (): Promise<Mailer> => {
  if (override) return override
  const settings = await mailerSettings()
  const kind = mailerKindFor(settings)
  const fingerprint = [
    kind,
    settings.from,
    `${settings.apiKey.length}:${settings.apiKey.slice(-4)}`,
    settings.smtp?.host,
    settings.smtp?.port,
    settings.smtp?.user,
    `${settings.smtp?.password?.length ?? 0}`,
  ].join('|')
  if (shared && sharedFingerprint === fingerprint) return shared
  shared =
    kind === 'resend'
      ? new ResendMailer(settings.apiKey, fetch, settings.from)
      : kind === 'smtp' && settings.smtp
        ? new SmtpMailer(settings.smtp, settings.from)
        : kind === 'none'
          ? new NoopMailer()
          : new ConsoleMailer()
  sharedFingerprint = fingerprint
  return shared
}

export interface MailerStatus {
  kind: Mailer['kind']
  from: string
  /** The SMTP host in use, for the admin screens. Never the credentials. */
  host: string | null
}

/** What the admin screens report about mail. */
export const mailerStatus = async (): Promise<MailerStatus> => {
  const settings = await mailerSettings()
  const kind = mailerKindFor(settings)
  return { kind, from: settings.from, host: kind === 'smtp' ? (settings.smtp?.host ?? null) : null }
}

/** Tests: swap the process-wide mailer. */
export const setMailer = (mailer: Mailer | undefined): void => {
  override = mailer
  shared = undefined
  sharedFingerprint = undefined
}
