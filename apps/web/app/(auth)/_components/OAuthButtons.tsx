import { fmt, messages } from '@palscans/core/messages'
import { buttonClasses } from '@palscans/ui'

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <path
        className="fill-brand-google-blue"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.9z"
      />
      <path
        className="fill-brand-google-green"
        d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3a7.2 7.2 0 0 1-10.8-3.8H1.3v3.1A12 12 0 0 0 12 24z"
      />
      <path
        className="fill-brand-google-yellow"
        d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z"
      />
      <path
        className="fill-brand-google-red"
        d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1A7.2 7.2 0 0 1 12 4.8z"
      />
    </svg>
  )
}

function DiscordMark() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="shrink-0 fill-brand-discord"
    >
      <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.2.4a13 13 0 0 1 3.3 1.7 15.7 15.7 0 0 0-13 0 13 13 0 0 1 3.3-1.7L8.6 3a19.8 19.8 0 0 0-4.9 1.4C.6 9.1-.2 13.6.2 18a19.9 19.9 0 0 0 6 3l1.3-2.1a12.8 12.8 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4a12.8 12.8 0 0 1-2 1l1.3 2.1a19.9 19.9 0 0 0 6-3c.5-5.1-.8-9.6-3.7-13.6zM8.5 15.3c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4zm7 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4z" />
    </svg>
  )
}

/** Google + Discord entry points; the return path rides along to the callback. */
export function OAuthButtons({ returnTo }: { returnTo: string }) {
  const qs = returnTo && returnTo !== '/' ? `?return=${encodeURIComponent(returnTo)}` : ''
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <a href={`/api/auth/google${qs}`} className={buttonClasses('outline', 'lg', 'w-full')}>
        <GoogleMark />
        {fmt(messages.authPage.continueWith, { provider: 'Google' })}
      </a>
      <a href={`/api/auth/discord${qs}`} className={buttonClasses('outline', 'lg', 'w-full')}>
        <DiscordMark />
        {fmt(messages.authPage.continueWith, { provider: 'Discord' })}
      </a>
    </div>
  )
}

export function Divider() {
  return (
    <div className="flex items-center gap-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">
      <span className="h-px flex-1 bg-line" />
      {messages.auth.or}
      <span className="h-px flex-1 bg-line" />
    </div>
  )
}
