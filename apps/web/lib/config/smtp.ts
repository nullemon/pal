import { connect as netConnect, type Socket } from 'node:net'
import { type TLSSocket, connect as tlsConnect } from 'node:tls'

/**
 * Just enough SMTP to prove the operator's mail credentials actually work (docs/19).
 *
 * This exists because the connection test has to be real. Anything less — checking that a
 * host resolves, or that the fields are non-empty — reports a green tick for a password that
 * will fail the first time a reader asks for a verification mail, which is exactly the
 * failure this screen is meant to catch. So it speaks the protocol: greeting, EHLO,
 * STARTTLS, AUTH, MAIL/RCPT/DATA, QUIT, and reports which of those steps refused it.
 *
 * Two rules it will not bend:
 *
 * - the password is never sent over an unencrypted link (a plain-text AUTH is refused unless
 *   the server is on this machine)
 * - nothing here is ever logged; every value stays in the returned result, and the result
 *   carries server replies, never credentials
 */

export type SmtpStep = 'connect' | 'greeting' | 'ehlo' | 'starttls' | 'auth' | 'send'

export interface SmtpResult {
  ok: boolean
  /** The first step that refused, when `ok` is false. */
  failedAt?: SmtpStep
  /** The server's reply code, when it gave one. */
  code?: number
  /** The server's own words, clamped — never anything the operator typed. */
  detail?: string
  /** Whether the session was encrypted by the time credentials were sent. */
  secure: boolean
  /** True when the server accepted the message body. */
  delivered: boolean
}

export interface SmtpOptions {
  host: string
  port: number
  user?: string
  password?: string
  /** The `From:` header, e.g. `PALScans <no-reply@example.org>`. */
  from: string
  to: string
  subject: string
  text: string
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 12_000

/** `Name <a@b>` → `a@b`; a bare address is returned as it is. */
export const bareAddress = (value: string): string => {
  const angled = /<([^>]+)>/.exec(value)
  return (angled?.[1] ?? value).trim()
}

const clamp = (value: string, max = 200): string =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`

/** Only these are safe in a header we build from operator input. */
const headerSafe = (value: string): string => value.replace(/[\r\n]+/g, ' ').trim()

const isLocal = (host: string): boolean =>
  host === 'localhost' || host === '127.0.0.1' || host === '::1'

interface Reply {
  code: number
  text: string
}

/** A live SMTP conversation over one socket, with a hard deadline for the whole exchange. */
class Session {
  private buffer = ''
  private waiting: ((reply: Reply | Error) => void) | null = null
  private closed: Error | null = null

  constructor(private socket: Socket | TLSSocket) {
    this.attach(socket)
  }

  private attach(socket: Socket | TLSSocket): void {
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      this.buffer += chunk
      this.drain()
    })
    socket.on('error', (err: Error) => this.stop(err))
    socket.on('close', () => this.stop(new Error('connection closed')))
  }

  private stop(err: Error): void {
    this.closed ??= err
    this.waiting?.(err)
    this.waiting = null
  }

  /** An SMTP reply ends on a line whose 4th character is a space (`250 Ok`). */
  private drain(): void {
    if (!this.waiting) return
    const lines = this.buffer.split(/\r?\n/)
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i] ?? ''
      if (line.length >= 4 && line[3] !== '-') {
        const text = lines.slice(0, i + 1).join('\n')
        this.buffer = lines.slice(i + 1).join('\r\n')
        const resolve = this.waiting
        this.waiting = null
        resolve?.({ code: Number.parseInt(line.slice(0, 3), 10), text })
        return
      }
    }
  }

  read(): Promise<Reply> {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(this.closed)
      this.waiting = (r) => (r instanceof Error ? reject(r) : resolve(r))
      this.drain()
    })
  }

  async send(line: string): Promise<Reply> {
    this.socket.write(`${line}\r\n`)
    return this.read()
  }

  /** Fire and forget: QUIT never blocks the result. */
  end(): void {
    try {
      this.socket.write('QUIT\r\n')
    } catch {
      // already gone
    }
    this.socket.destroy()
  }

  /** Hand the same conversation a TLS socket after STARTTLS. */
  upgrade(socket: TLSSocket): void {
    this.socket = socket
    this.buffer = ''
    this.attach(socket)
  }
}

const openSocket = (
  host: string,
  port: number,
  secure: boolean,
  timeoutMs: number,
): Promise<Socket | TLSSocket> =>
  new Promise((resolve, reject) => {
    const socket = secure
      ? tlsConnect({ host, port, servername: host })
      : netConnect({ host, port })
    const onReady = () => {
      socket.setTimeout(0)
      resolve(socket)
    }
    socket.setTimeout(timeoutMs, () => {
      socket.destroy()
      reject(new Error('timed out'))
    })
    socket.once(secure ? 'secureConnect' : 'connect', onReady)
    socket.once('error', (err: Error) => reject(err))
  })

const upgradeSocket = (socket: Socket, host: string, timeoutMs: number): Promise<TLSSocket> =>
  new Promise((resolve, reject) => {
    const tls = tlsConnect({ socket, servername: host })
    const timer = setTimeout(() => {
      tls.destroy()
      reject(new Error('timed out'))
    }, timeoutMs)
    tls.once('secureConnect', () => {
      clearTimeout(timer)
      resolve(tls)
    })
    tls.once('error', (err: Error) => {
      clearTimeout(timer)
      reject(err)
    })
  })

const fail = (
  failedAt: SmtpStep,
  reply: Reply | Error,
  secure: boolean,
): SmtpResult & { ok: false } => ({
  ok: false,
  failedAt,
  secure,
  delivered: false,
  ...(reply instanceof Error
    ? { detail: clamp(reply.message) }
    : { code: reply.code, detail: clamp(reply.text) }),
})

/**
 * Connect, authenticate and send one message. Returns which step failed rather than
 * throwing, so the caller can tell "wrong password" from "host unreachable" from "the
 * recipient was rejected".
 */
export const smtpSendTest = async (opts: SmtpOptions): Promise<SmtpResult> => {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const implicitTls = opts.port === 465
  let secure = implicitTls
  let socket: Socket | TLSSocket
  try {
    socket = await openSocket(opts.host, opts.port, implicitTls, timeoutMs)
  } catch (err) {
    return fail('connect', err instanceof Error ? err : new Error('connect failed'), secure)
  }

  const session = new Session(socket)
  const deadline = setTimeout(() => session.end(), timeoutMs * 3)
  try {
    const greeting = await session.read()
    if (greeting.code !== 220) return fail('greeting', greeting, secure)

    const me = 'palscans.local'
    let ehlo = await session.send(`EHLO ${me}`)
    if (ehlo.code !== 250) return fail('ehlo', ehlo, secure)

    if (!secure && /STARTTLS/i.test(ehlo.text)) {
      const start = await session.send('STARTTLS')
      if (start.code !== 220) return fail('starttls', start, secure)
      session.upgrade(await upgradeSocket(socket as Socket, opts.host, timeoutMs))
      secure = true
      ehlo = await session.send(`EHLO ${me}`)
      if (ehlo.code !== 250) return fail('ehlo', ehlo, secure)
    }

    if (opts.user && opts.password) {
      if (!secure && !isLocal(opts.host))
        return fail('starttls', new Error('server does not offer STARTTLS'), secure)
      const b64 = (v: string) => Buffer.from(v, 'utf8').toString('base64')
      let auth: Reply
      if (/AUTH[ =-][^\n]*PLAIN/i.test(ehlo.text)) {
        auth = await session.send(`AUTH PLAIN ${b64(`\0${opts.user}\0${opts.password}`)}`)
      } else {
        const user = await session.send('AUTH LOGIN')
        if (user.code !== 334) return fail('auth', user, secure)
        const pass = await session.send(b64(opts.user))
        if (pass.code !== 334) return fail('auth', pass, secure)
        auth = await session.send(b64(opts.password))
      }
      if (auth.code !== 235) return fail('auth', auth, secure)
    }

    const mailFrom = await session.send(`MAIL FROM:<${bareAddress(opts.from)}>`)
    if (mailFrom.code !== 250) return fail('send', mailFrom, secure)
    const rcpt = await session.send(`RCPT TO:<${bareAddress(opts.to)}>`)
    if (rcpt.code !== 250 && rcpt.code !== 251) return fail('send', rcpt, secure)
    const data = await session.send('DATA')
    if (data.code !== 354) return fail('send', data, secure)

    const body = [
      `From: ${headerSafe(opts.from)}`,
      `To: <${bareAddress(opts.to)}>`,
      `Subject: ${headerSafe(opts.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      // A line that is only a dot ends DATA, so any such line is escaped.
      ...opts.text.split('\n').map((l) => (l === '.' ? '..' : l)),
      '.',
    ].join('\r\n')
    const accepted = await session.send(body)
    if (accepted.code !== 250) return fail('send', accepted, secure)
    return { ok: true, secure, delivered: true, code: accepted.code, detail: clamp(accepted.text) }
  } catch (err) {
    return fail('send', err instanceof Error ? err : new Error('failed'), secure)
  } finally {
    clearTimeout(deadline)
    session.end()
  }
}
