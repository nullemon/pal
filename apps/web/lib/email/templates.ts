import type { CopyFn } from '@palscans/core/copy'
import { messages } from '@palscans/core/messages'
import { getEnv } from '../env'
import type { Mail } from './mailer'

/**
 * The four transactional emails. Their subjects and intros are operator-editable (docs/15
 * "Copy the operator owns"), which is why every template takes a resolved `copy` lookup
 * rather than reading the catalogue itself: these run from route handlers and from the
 * worker, and both already have the settings in hand.
 *
 * ## Why operator text is safe here
 *
 * Two things could go wrong and neither can:
 *
 * - **HTML injection.** `layout()` escapes every line and every attribute it interpolates,
 *   and it has done since before this copy was editable. An operator who pastes
 *   `<img src=x onerror=…>` into an intro gets that text, rendered as text, in the mail.
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

const layout = (title: string, lines: string[], cta?: { href: string; label: string }) => {
  const site = getEnv().SITE_NAME
  const body = lines.map((l) => `<p style="margin:0 0 12px">${escapeHtml(l)}</p>`).join('')
  const button = cta
    ? `<p style="margin:20px 0"><a href="${escapeHtml(cta.href)}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px">${escapeHtml(cta.label)}</a></p><p style="margin:0 0 12px;color:#9e97b8;font-size:13px">${escapeHtml(cta.href)}</p>`
    : ''
  return `<!doctype html><html><body style="margin:0;background:#100d17;color:#ece9f4;font-family:ui-sans-serif,system-ui,sans-serif;padding:32px"><div style="max-width:520px;margin:0 auto;background:#181423;border:1px solid #2c2540;border-radius:14px;padding:28px"><p style="margin:0 0 20px;font-weight:800;letter-spacing:-.02em;font-size:18px">${escapeHtml(site)}</p><h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>${body}${button}</div></body></html>`
}

const link = (path: string) => `${getEnv().SITE_URL.replace(/\/+$/, '')}${path}`

export const verifyEmailMail = (to: string, token: string, copy: CopyFn): Mail => {
  const href = link(`/verify?token=${encodeURIComponent(token)}`)
  const subject = copy('email.verify.subject')
  const intro = copy('email.verify.intro')
  const m = MAIL_FIXED.verify
  return {
    to,
    subject,
    text: `${intro}\n\n${href}\n\n${m.expiry}`,
    html: layout(subject, [intro, m.expiry], { href, label: m.cta }),
  }
}

export const resetPasswordMail = (to: string, token: string, copy: CopyFn): Mail => {
  const href = link(`/reset-password?token=${encodeURIComponent(token)}`)
  const subject = copy('email.reset.subject')
  const intro = copy('email.reset.intro')
  const m = MAIL_FIXED.reset
  return {
    to,
    subject,
    text: `${intro}\n\n${href}\n\n${m.expiry}\n${m.ignore}`,
    html: layout(subject, [intro, m.expiry, m.ignore], { href, label: m.cta }),
  }
}

export const passwordChangedMail = (to: string, copy: CopyFn): Mail => {
  const subject = copy('email.passwordChanged.subject')
  const intro = copy('email.passwordChanged.intro')
  const m = MAIL_FIXED.passwordChanged
  return {
    to,
    subject,
    text: `${intro}\n${m.ignore}`,
    html: layout(subject, [intro, m.ignore]),
  }
}

export const deletionScheduledMail = (to: string, purgeAt: Date, copy: CopyFn): Mail => {
  const subject = copy('email.deletion.subject')
  const intro = copy('email.deletion.intro')
  const m = MAIL_FIXED.deletion
  const when = purgeAt.toISOString().slice(0, 10)
  const href = link('/me/settings#delete')
  return {
    to,
    subject,
    text: `${intro} ${when}.\n\n${m.cancel}\n${href}`,
    html: layout(subject, [`${intro} ${when}.`, m.cancel], { href, label: m.cta }),
  }
}
