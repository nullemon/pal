import { copyFn, DEFAULT_COPY, resolveCopy } from '@palscans/core/copy'
import { describe, expect, it, vi } from 'vitest'

/**
 * Appearance → Copy makes four email subjects and four intros operator-authored. This is the
 * one place in the feature where operator text leaves React's escaping and lands in a string
 * that something else parses — an HTML body and, over SMTP, a header. Both are checked here
 * with the nastiest thing an operator could paste.
 */

vi.mock('../env', () => ({
  getEnv: () => ({ SITE_NAME: 'PALScans', SITE_URL: 'https://palscans.org' }),
  isLoopbackHttp: () => false,
}))

const { verifyEmailMail, resetPasswordMail, passwordChangedMail, deletionScheduledMail } =
  await import('./templates')

const XSS = '<img src=x onerror="alert(1)">'
const INJECT = 'Verify your email\r\nBcc: attacker@example.com'

const copyWith = (overrides: Record<string, string>) => copyFn(resolveCopy(overrides))

describe('with nothing configured', () => {
  it('sends exactly the shipped subjects and intros', async () => {
    const mail = await verifyEmailMail('reader@example.com', 'tok', copyFn(DEFAULT_COPY))
    expect(mail.subject).toBe(DEFAULT_COPY['email.verify.subject'])
    expect(mail.text).toContain(DEFAULT_COPY['email.verify.intro'] as string)
    expect(mail.html).toContain('Verify email')
  })
})

describe('an operator who pastes markup', () => {
  it('cannot get it into the HTML body', async () => {
    const copy = copyWith({ 'email.reset.intro': `Hello ${XSS}` })
    const mail = await resetPasswordMail('reader@example.com', 'tok', copy)
    expect(mail.html).not.toContain('<img')
    // The characters survive as text; what does not survive is the syntax — the tag is not
    // a tag and the attribute's quotes are entities, so nothing here is parsed as markup.
    expect(mail.html).not.toContain('onerror="alert')
    expect(mail.html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
    // The plain-text part is not parsed by anything, so it carries the characters as typed.
    expect(mail.text).toContain(XSS)
  })

  it('cannot get it into the subject line either', async () => {
    const copy = copyWith({ 'email.passwordChanged.subject': `Changed ${XSS}` })
    const mail = await passwordChangedMail('reader@example.com', copy)
    expect(mail.subject).toBe(`Changed ${XSS}`)
    // The subject is also the <h1>; that is the escaped copy, not the raw one.
    expect(mail.html).toContain('&lt;img')
    expect(mail.html).not.toContain('<img')
  })
})

describe('an operator who pastes a newline into a subject', () => {
  it('never produces a header break, because the override is normalised on the way in', async () => {
    const copy = copyWith({ 'email.verify.subject': INJECT })
    const mail = await verifyEmailMail('reader@example.com', 'tok', copy)
    expect(mail.subject).not.toMatch(/[\r\n]/)
    expect(mail.subject).toBe('Verify your email Bcc: attacker@example.com')
  })
})

describe('an override that the resolver rejects', () => {
  it('falls back, so the mail still says something sensible', async () => {
    const copy = copyWith({
      'email.deletion.subject': '',
      'email.deletion.intro': 'x'.repeat(5_000),
    })
    const mail = await deletionScheduledMail(
      'reader@example.com',
      new Date('2026-10-01T00:00:00Z'),
      copy,
    )
    expect(mail.subject).toBe(DEFAULT_COPY['email.deletion.subject'])
    expect(mail.text).toContain(DEFAULT_COPY['email.deletion.intro'] as string)
    expect(mail.text).toContain('2026-10-01')
  })
})
