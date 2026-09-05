import type { CopyFn } from '@palscans/core/copy'
import { fmt, messages } from '@palscans/core/messages'
import { getEnv } from '../env'
import type { Mail } from './mailer'
import {
  EMAIL_LOGO_PX,
  EMAIL_SURFACE,
  type EmailTheme,
  emailTheme,
  SHIPPED_BUTTON,
  safeColor,
} from './theme'

/**
 * The four transactional emails. Their subjects, intros and the small print under them are
 * operator-editable (docs/15 "Copy the operator owns"), which is why every template takes a
 * resolved `copy` lookup rather than reading the catalogue itself: these run from route
 * handlers and from the worker, and both already have the settings in hand.
 *
 * The mark, the accent and the name in the masthead come from `./theme.ts` — the operator's
 * Brand and Theme documents, not a fourth setting. Read that file for why the logo is a
 * generated PNG served by the app rather than the upload's own URL.
 *
 * ## Why operator text is safe here
 *
 * Two things could go wrong and neither can:
 *
 * - **HTML injection.** `renderEmailHtml()` escapes every line and every attribute it
 *   interpolates, and it has done since before this copy was editable. An operator who
 *   pastes `<img src=x onerror=…>` into an intro — or into the footer line, or into the site
 *   name that the footer's `{site}` becomes — gets that text, rendered as text, in the mail.
 *   The one thing that is *not* escaped-and-hoped-for is a colour: an operator-chosen accent
 *   lands inside a `style` attribute, where escaping is not enough, so `safeColor()` passes
 *   nothing but `#rrggbb` through in the first place.
 * - **Header injection.** A subject carrying `\r\n` is how `Bcc:` gets added to somebody
 *   else's mail. Two independent guards: `normalizeCopyText` in `@palscans/core/copy`
 *   strips every control character before an override is stored *or* resolved, and
 *   `lib/config/smtp.ts` runs `headerSafe()` on the subject at the wire. Resend takes the
 *   subject as a JSON field, which is not a header context at all.
 */

/**
 * The parts of each mail that are *not* editable: the button labels and the expiry / "was
 * this not you" lines. They state what the link does and how long it lasts, which is a
 * security promise the product makes, not a matter of voice.
 */
const MAIL_FIXED = messages.email

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  )

interface Layout {
  title: string
  lines: string[]
  /** The small print under the card. Operator-authored; escaped like everything else. */
  footer: string
  cta?: { href: string; label: string }
}

/**
 * One mail, as HTML. Pure — the theme is resolved by the caller — so the escaping rules and
 * the contrast rule are testable without a database.
 *
 * ## Dark mode
 *
 * The mail is dark, as it always has been, and says so: `color-scheme: dark` tells Apple
 * Mail, Outlook and iOS that it has handled the dark case itself, which stops them
 * re-colouring it. That matters more here than it did before — a client that inverts the
 * card to white while leaving the accent button alone would undo exactly the 4.5:1 the
 * palette just computed. The clients that invert anyway (Gmail on Android) cannot break the
 * mark, because it is an opaque tile rather than a transparent PNG, and cannot break the
 * button, because inverting a dark ground makes it lighter and the ink is chosen against the
 * button, not against the page.
 *
 * Everything is an inline style on a `<div>`: no `<style>` block (Gmail keeps it, most
 * clients strip it), no CSS background image, no web font.
 */
export const renderEmailHtml = (theme: EmailTheme, { title, lines, footer, cta }: Layout) => {
  // Escaping is the wrong tool for a colour: `#fff" onmouseover="…` escapes to something
  // harmless-looking that is still not a colour, and a CSS value has its own escape rules
  // anyway. So the two rules are enforced here, at the point of interpolation, rather than
  // trusted from the caller — a hand-built theme is as safe as a resolved one.
  const accent = safeColor(theme.accent, SHIPPED_BUTTON.accent)
  const ink = safeColor(theme.ink, SHIPPED_BUTTON.ink)
  const src = theme.logo && /^https?:\/\/[^/]/i.test(theme.logo) ? theme.logo : null
  const body = lines.map((l) => `<p style="margin:0 0 12px">${escapeHtml(l)}</p>`).join('')
  const button = cta
    ? `<p style="margin:20px 0"><a href="${escapeHtml(cta.href)}" style="display:inline-block;background:${accent};color:${ink};text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px">${escapeHtml(cta.label)}</a></p><p style="margin:0 0 12px;color:${EMAIL_SURFACE.muted};font-size:13px">${escapeHtml(cta.href)}</p>`
    : ''
  // `alt=""`: the site name is printed underneath either way, so a client with images off
  // (Gmail's default for an unknown sender) shows the masthead it always showed rather than
  // a second copy of the name where the mark would be.
  const logo = src
    ? `<img src="${escapeHtml(src)}" width="${EMAIL_LOGO_PX}" height="${EMAIL_LOGO_PX}" alt="" style="display:block;border:0;width:${EMAIL_LOGO_PX}px;height:${EMAIL_LOGO_PX}px;border-radius:10px;margin:0 0 14px">`
    : ''
  // The accent rule is what carries the theme in the two mails that have no button. An empty
  // div collapses in Outlook, hence the zero-sized nbsp.
  const rule = `<div style="height:3px;background:${accent};font-size:0;line-height:0">&nbsp;</div>`
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"></head><body style="margin:0;background:${EMAIL_SURFACE.page};color:${EMAIL_SURFACE.ink};font-family:ui-sans-serif,system-ui,sans-serif;padding:32px"><div style="max-width:520px;margin:0 auto;background:${EMAIL_SURFACE.card};border:1px solid ${EMAIL_SURFACE.line};border-radius:14px;overflow:hidden">${rule}<div style="padding:28px">${logo}<p style="margin:0 0 20px;font-weight:800;letter-spacing:-.02em;font-size:18px">${escapeHtml(theme.siteName)}</p><h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>${body}${button}</div></div><p style="max-width:520px;margin:16px auto 0;color:${EMAIL_SURFACE.muted};font-size:12px;line-height:1.6">${escapeHtml(footer)}</p></body></html>`
}

const link = (path: string) => `${getEnv().SITE_URL.replace(/\/+$/, '')}${path}`

interface Parts {
  subject: string
  /** The paragraphs of the HTML body. */
  lines: string[]
  /** The plain-text alternative, without the footer. */
  text: string
  cta?: { href: string; label: string }
}

/**
 * Both alternatives of one mail, from one theme read.
 *
 * The footer line lands in the text part too. A theme that made the HTML prettier and left
 * the plain-text alternative saying less than it used to would be a regression for every
 * reader whose client shows text — and for the spam filters that compare the two.
 */
const compose = async (to: string, copy: CopyFn, parts: Parts): Promise<Mail> => {
  const theme = await emailTheme()
  const footer = fmt(copy('email.footer'), { site: theme.siteName })
  return {
    to,
    subject: parts.subject,
    text: `${parts.text}\n\n${footer}`,
    html: renderEmailHtml(theme, {
      title: parts.subject,
      lines: parts.lines,
      footer,
      ...(parts.cta ? { cta: parts.cta } : {}),
    }),
  }
}

export const verifyEmailMail = async (to: string, token: string, copy: CopyFn): Promise<Mail> => {
  const href = link(`/verify?token=${encodeURIComponent(token)}`)
  const subject = copy('email.verify.subject')
  const intro = copy('email.verify.intro')
  const m = MAIL_FIXED.verify
  return compose(to, copy, {
    subject,
    lines: [intro, m.expiry],
    text: `${intro}\n\n${href}\n\n${m.expiry}`,
    cta: { href, label: m.cta },
  })
}

export const resetPasswordMail = async (to: string, token: string, copy: CopyFn): Promise<Mail> => {
  const href = link(`/reset-password?token=${encodeURIComponent(token)}`)
  const subject = copy('email.reset.subject')
  const intro = copy('email.reset.intro')
  const m = MAIL_FIXED.reset
  return compose(to, copy, {
    subject,
    lines: [intro, m.expiry, m.ignore],
    text: `${intro}\n\n${href}\n\n${m.expiry}\n${m.ignore}`,
    cta: { href, label: m.cta },
  })
}

export const passwordChangedMail = async (to: string, copy: CopyFn): Promise<Mail> => {
  const subject = copy('email.passwordChanged.subject')
  const intro = copy('email.passwordChanged.intro')
  const m = MAIL_FIXED.passwordChanged
  return compose(to, copy, {
    subject,
    lines: [intro, m.ignore],
    text: `${intro}\n${m.ignore}`,
  })
}

export const deletionScheduledMail = async (
  to: string,
  purgeAt: Date,
  copy: CopyFn,
): Promise<Mail> => {
  const subject = copy('email.deletion.subject')
  const intro = copy('email.deletion.intro')
  const m = MAIL_FIXED.deletion
  const when = purgeAt.toISOString().slice(0, 10)
  const href = link('/me/settings#delete')
  return compose(to, copy, {
    subject,
    lines: [`${intro} ${when}.`, m.cancel],
    text: `${intro} ${when}.\n\n${m.cancel}\n${href}`,
    cta: { href, label: m.cta },
  })
}
