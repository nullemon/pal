import { messages } from '@palscans/core/messages'
import { cn, RelativeTime } from '@palscans/ui'
import { formatPlace, type LoginEventRow } from '@/lib/auth/login-events'

const outcomeClass: Record<string, string> = {
  success: 'text-ok',
  bad_password: 'text-danger',
  locked: 'text-warn',
  totp_failed: 'text-danger',
  banned: 'text-fg-muted',
}

const label = (table: Record<string, string>, key: string, fallback: string = key): string =>
  table[key] ?? fallback

/**
 * /me/security → sign-in history (docs/17 §C). The row that created the session the reader
 * is browsing with is marked "this device", so an unfamiliar row stands out next to it.
 */
export function LoginHistoryTable({
  rows,
  currentSessionId,
  page,
  pages,
}: {
  rows: LoginEventRow[]
  currentSessionId: string | null
  page: number
  pages: number
}) {
  const m = messages.me.security
  if (rows.length === 0) return <p className="text-[13px] text-fg-muted">{m.noHistory}</p>
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.06em] text-fg-subtle">
              <th className="h-9 px-3 font-semibold">{m.colWhen}</th>
              <th className="h-9 px-3 font-semibold">{m.colDevice}</th>
              {/* On a phone the place and method move under the device name. */}
              <th className="hidden h-9 px-3 font-semibold sm:table-cell">{m.colWhere}</th>
              <th className="hidden h-9 px-3 font-semibold sm:table-cell">{m.colMethod}</th>
              <th className="h-9 px-3 text-right font-semibold">{m.colOutcome}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const device =
                [r.browser, r.os].filter((v) => v && v !== 'Unknown').join(' · ') || m.unknownDevice
              const here = !!r.sessionId && r.sessionId === currentSessionId
              return (
                <tr key={r.id} className="border-b border-line-soft last:border-0">
                  <td className="h-11 whitespace-nowrap px-3 align-middle text-fg-muted">
                    <RelativeTime iso={r.at.toISOString()} />
                  </td>
                  <td className="h-11 px-3 align-middle">
                    <span className="font-semibold text-fg">{device}</span>
                    {here ? (
                      <span className="ml-2 rounded-sm bg-brand-wash px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-brand-hover">
                        {messages.auth.thisDevice}
                      </span>
                    ) : null}
                    <span className="block text-[12px] text-fg-muted sm:hidden">
                      {formatPlace(r) ?? m.unknownPlace} ·{' '}
                      {label(messages.loginEvents.methods, r.method)}
                    </span>
                  </td>
                  <td className="hidden h-11 px-3 align-middle text-fg-muted sm:table-cell">
                    {formatPlace(r) ?? m.unknownPlace}
                  </td>
                  <td className="hidden h-11 px-3 align-middle text-fg-muted sm:table-cell">
                    {label(messages.loginEvents.methods, r.method)}
                  </td>
                  <td
                    className={cn(
                      'h-11 px-3 text-right align-middle font-semibold',
                      outcomeClass[r.outcome] ?? 'text-fg-muted',
                    )}
                  >
                    {label(messages.loginEvents.outcomes, r.outcome)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {pages > 1 ? (
        <nav className="flex items-center justify-end gap-3 text-[13px]">
          {page > 1 ? (
            <a className="text-brand-hover hover:underline" href={`/me/security?lp=${page - 1}`}>
              {m.newerHistory}
            </a>
          ) : null}
          {page < pages ? (
            <a className="text-brand-hover hover:underline" href={`/me/security?lp=${page + 1}`}>
              {m.olderHistory}
            </a>
          ) : null}
        </nav>
      ) : null}
    </div>
  )
}
