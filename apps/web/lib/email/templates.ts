import { messages } from '@palscans/core/messages'
import { getEnv } from '../env'
import type { Mail } from './mailer'

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

export const verifyEmailMail = (to: string, token: string): Mail => {
  const href = link(`/verify?token=${encodeURIComponent(token)}`)
  const m = messages.email.verify
  return {
    to,
    subject: m.subject,
    text: `${m.intro}\n\n${href}\n\n${m.expiry}`,
    html: layout(m.subject, [m.intro, m.expiry], { href, label: m.cta }),
  }
}

export const resetPasswordMail = (to: string, token: string): Mail => {
  const href = link(`/reset-password?token=${encodeURIComponent(token)}`)
  const m = messages.email.reset
  return {
    to,
    subject: m.subject,
    text: `${m.intro}\n\n${href}\n\n${m.expiry}\n${m.ignore}`,
    html: layout(m.subject, [m.intro, m.expiry, m.ignore], { href, label: m.cta }),
  }
}

export const passwordChangedMail = (to: string): Mail => {
  const m = messages.email.passwordChanged
  return {
    to,
    subject: m.subject,
    text: `${m.intro}\n${m.ignore}`,
    html: layout(m.subject, [m.intro, m.ignore]),
  }
}

export const deletionScheduledMail = (to: string, purgeAt: Date): Mail => {
  const m = messages.email.deletion
  const when = purgeAt.toISOString().slice(0, 10)
  const href = link('/me/settings#delete')
  return {
    to,
    subject: m.subject,
    text: `${m.intro} ${when}.\n\n${m.cancel}\n${href}`,
    html: layout(m.subject, [`${m.intro} ${when}.`, m.cancel], { href, label: m.cta }),
  }
}
