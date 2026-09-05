import { copyFn, DEFAULT_COPY, resolveCopy } from '@palscans/core/copy'
import { describe, expect, it, vi } from 'vitest'

/**
 * Appearance → Copy makes four email subjects, four intros and the small print under every
 * mail operator-authored, and Appearance → Brand and Theme put a mark and a colour in the
 * same body. This is the one place in the feature where operator input leaves React's
 * escaping and lands in strings that something else parses — an HTML body, a `style`
 * attribute and, over SMTP, a header. All three are checked here with the nastiest thing an
 * operator could paste.
 */

vi.mock('../env', () => ({
  getEnv: () => ({ SITE_NAME: 'PALScans', SITE_URL: 'https://palscans.org' }),
  isLoopbackHttp: () => false,
}))

const {
  verifyEmailMail,
  resetPasswordMail,
  passwordChangedMail,
  deletionScheduledMail,
  renderEmailHtml,
} = await import('./templates')

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

  it('sends the shipped violet button and no logo', async () => {
    // No database here, so every theme read falls back — which is exactly the state of a site
    // that has configured nothing, and it must be the mail that shipped.
    const mail = await verifyEmailMail('reader@example.com', 'tok', copyFn(DEFAULT_COPY))
    expect(mail.html).toContain('background:#7c3aed')
    expect(mail.html).not.toContain('<img')
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

/**
 * The theme puts three more operator-controlled values into the same body: a mark, a colour
 * and the footer line. The colour is the one escaping would not have saved us from, so it is
 * checked here next to the text. The theme is passed in rather than loaded, which is what
 * lets these run against a configured site without a database.
 */
const themed = (over: Partial<Parameters<typeof renderEmailHtml>[0]> = {}) => ({
  siteName: 'Scanlations',
  logo: 'https://palscans.org/brand/1abcde/apple-touch-icon.png',
  accent: '#fffb00',
  ink: '#100d17',
  ...over,
})

const RESET = {
  title: 'Reset your password',
  lines: ['Someone asked to reset the password for this address.'],
  footer: 'You are receiving this because this address was used on Scanlations.',
  cta: { href: 'https://palscans.org/reset-password?token=abc', label: 'Choose a new password' },
}

describe('a themed mail, as a mail client sees it', () => {
  it('puts nothing but absolute URLs in front of it', () => {
    const html = renderEmailHtml(themed(), RESET)
    const urls = [...html.matchAll(/(?:src|href)="([^"]*)"/g)].map((m) => m[1] as string)
    expect(urls.length).toBeGreaterThanOrEqual(2)
    for (const url of urls) expect(url).toMatch(/^https:\/\//)
  })

  it('uses no SVG, no background image, no web font and no stylesheet', () => {
    const html = renderEmailHtml(themed(), RESET)
    expect(html).not.toMatch(/\.svg/i)
    expect(html).not.toContain('background-image')
    expect(html).not.toContain('url(')
    expect(html).not.toContain('@font-face')
    expect(html).not.toContain('<style')
    expect(html).toContain('<img src="https://palscans.org/brand/1abcde/apple-touch-icon.png"')
    // Width and height as attributes, not only in the style: Outlook sizes from these.
    expect(html).toContain('width="48" height="48"')
  })

  it('leaves the masthead exactly as it was when no mark is configured', () => {
    const html = renderEmailHtml(themed({ logo: null }), RESET)
    expect(html).not.toContain('<img')
    expect(html).toContain('Scanlations')
  })

  it('drops a logo URL that is not absolute rather than emitting a dead image', () => {
    const html = renderEmailHtml(themed({ logo: '/_storage/brand/logo.png' }), RESET)
    expect(html).not.toContain('<img')
  })

  it('cannot be pushed out of the style attribute by a forged colour', () => {
    const html = renderEmailHtml(
      themed({ accent: '#fff" onmouseover="alert(1)', ink: 'red}</style>' }),
      RESET,
    )
    expect(html).not.toContain('onmouseover')
    expect(html).not.toContain('</style>')
    // Falls back to the shipped button rather than to no colour at all.
    expect(html).toContain('background:#7c3aed')
  })
})

describe('an operator who pastes markup into the footer line', () => {
  it('cannot get it into the HTML body', () => {
    const html = renderEmailHtml(themed(), { ...RESET, footer: `Unsubscribe ${XSS}` })
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
  })

  it('cannot get it in through the site name that the {site} token becomes either', () => {
    const html = renderEmailHtml(themed({ siteName: XSS }), RESET)
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img')
  })
})

describe('the footer line', () => {
  it('is under all four mails, in both alternatives, with the site name filled in', async () => {
    const copy = copyFn(DEFAULT_COPY)
    const mails = [
      await verifyEmailMail('reader@example.com', 'tok', copy),
      await resetPasswordMail('reader@example.com', 'tok', copy),
      await passwordChangedMail('reader@example.com', copy),
      await deletionScheduledMail('reader@example.com', new Date('2026-10-01T00:00:00Z'), copy),
    ]
    for (const mail of mails) {
      expect(mail.text).toContain('used to create or manage an account on PALScans.')
      expect(mail.html).toContain('used to create or manage an account on PALScans.')
    }
  })

  it('takes the operator wording, escaped in HTML and as typed in text', async () => {
    const copy = copyWith({ 'email.footer': 'Sent by {site}. Reply to unsubscribe <>.' })
    const mail = await passwordChangedMail('reader@example.com', copy)
    expect(mail.text).toContain('Sent by PALScans. Reply to unsubscribe <>.')
    expect(mail.html).toContain('Sent by PALScans. Reply to unsubscribe &lt;&gt;.')
  })

  it('falls back to the shipped line when the override uses a token nothing substitutes', async () => {
    const copy = copyWith({ 'email.footer': 'Unsubscribe: {unsubscribe_url}' })
    const mail = await passwordChangedMail('reader@example.com', copy)
    expect(mail.text).toContain('used to create or manage an account on PALScans.')
    expect(mail.text).not.toContain('{unsubscribe_url}')
  })
})

describe('the plain-text alternative', () => {
  it('carries no markup and no colours, only the words and the link', async () => {
    const mail = await verifyEmailMail('reader@example.com', 'tok', copyFn(DEFAULT_COPY))
    expect(mail.text).not.toMatch(/<[a-z!/]/i)
    expect(mail.text).not.toMatch(/#[0-9a-f]{6}/i)
    expect(mail.text).not.toContain('apple-touch-icon')
    expect(mail.text).toContain('https://palscans.org/verify?token=tok')
  })
})
