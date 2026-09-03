import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Which transport the operator's settings select, and that changing them takes effect without
 * a restart (docs/19). The store is stubbed because the precedence rule underneath it is
 * proved end to end against a real database in `lib/config/store.test.ts`; what matters here
 * is only what this module does with the values it is handed.
 */
let values: Record<string, string>

vi.mock('../config/store', () => ({
  resolveConfig: async () => ({ values, sources: {} }),
}))

const { getMailer, mailerKindFor, mailerSettings, mailerStatus, setMailer } = await import(
  './mailer'
)

beforeEach(() => {
  values = {}
  setMailer(undefined)
})

describe('choosing a transport', () => {
  it('sends through Resend when a key is set', async () => {
    values = { 'email.resend_api_key': 're_live_1', 'email.from': 'PALScans <a@b.c>' }
    expect((await getMailer()).kind).toBe('resend')
  })

  it('falls back to SMTP when there is a host but no Resend key', async () => {
    values = { 'email.smtp_host': 'smtp.example.org', 'email.smtp_port': '2525' }
    expect((await getMailer()).kind).toBe('smtp')
    expect((await mailerSettings()).smtp).toEqual({
      host: 'smtp.example.org',
      port: 2525,
      user: undefined,
      password: undefined,
    })
  })

  it('defaults the SMTP port when the operator leaves it blank or types nonsense', async () => {
    values = { 'email.smtp_host': 'smtp.example.org', 'email.smtp_port': 'eight' }
    expect((await mailerSettings()).smtp?.port).toBe(587)
  })

  it('is the console with neither, outside production', async () => {
    expect((await getMailer()).kind).toBe('console')
  })

  it('refuses to print a link to stdout on a deployed production server', () => {
    const env = { NODE_ENV: 'production', SITE_URL: 'https://palscans.org' }
    const settings = { apiKey: '', from: 'x', smtp: null }
    // biome-ignore lint/suspicious/noExplicitAny: only the two fields read are supplied
    expect(mailerKindFor(settings, env as any)).toBe('none')
    // …but a production build started on an explicit loopback origin is a local run.
    const local = { NODE_ENV: 'production', SITE_URL: 'http://localhost:3000' }
    // biome-ignore lint/suspicious/noExplicitAny: as above
    expect(mailerKindFor(settings, local as any)).toBe('console')
  })
})

describe('reacting to a save', () => {
  it('rebuilds when the settings change, and not otherwise', async () => {
    values = { 'email.resend_api_key': 're_live_1' }
    const first = await getMailer()
    expect(await getMailer()).toBe(first)
    values = { 'email.resend_api_key': 're_live_2' }
    const second = await getMailer()
    expect(second).not.toBe(first)
    expect(second.kind).toBe('resend')
  })

  it('stays swapped when a test installs its own mailer', async () => {
    const stub = { kind: 'none' as const, send: async () => ({ ok: false }) }
    setMailer(stub)
    values = { 'email.resend_api_key': 're_live_1' }
    expect(await getMailer()).toBe(stub)
  })
})

describe('what the admin screens are told', () => {
  it('names the transport and the host, never the credentials', async () => {
    values = {
      'email.smtp_host': 'smtp.example.org',
      'email.smtp_password': 'hunter2',
      'email.from': 'PALScans <a@b.c>',
    }
    const status = await mailerStatus()
    expect(status).toEqual({ kind: 'smtp', from: 'PALScans <a@b.c>', host: 'smtp.example.org' })
    expect(JSON.stringify(status)).not.toContain('hunter2')
  })

  it('reports no SMTP host once Resend is in charge of sending', async () => {
    values = { 'email.resend_api_key': 're_live_1', 'email.smtp_host': 'smtp.example.org' }
    expect(await mailerStatus()).toMatchObject({ kind: 'resend', host: null })
  })
})
