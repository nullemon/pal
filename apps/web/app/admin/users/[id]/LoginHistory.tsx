import { messages } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import {
  EmptyRow,
  Pagination,
  Panel,
  PanelHeader,
  Pill,
  type PillTone,
  Table,
  Td,
  Th,
  When,
} from '@/components/admin/ui'
import { formatPlace, type LoginEventRow } from '@/lib/auth/login-events'

const outcomeTone: Record<string, PillTone> = {
  success: 'ok',
  bad_password: 'danger',
  locked: 'warn',
  totp_failed: 'danger',
  banned: 'neutral',
}

export const outcomeLabel = (outcome: string): string =>
  messages.loginEvents.outcomes[outcome as keyof typeof messages.loginEvents.outcomes] ?? outcome

export const methodLabel = (method: string): string =>
  messages.loginEvents.methods[method as keyof typeof messages.loginEvents.methods] ?? method

export const deviceLabel = (row: Pick<LoginEventRow, 'device' | 'browser' | 'os'>): string =>
  [row.browser, row.os].filter((v) => v && v !== 'Unknown').join(' · ') || (row.device ?? '—')

/**
 * Admin → Users → detail: the account's sign-in history (docs/17 §C), paginated on `?lp=`
 * so it can be walked without losing the rest of the page.
 */
export function LoginHistory({
  rows,
  page,
  pages,
  hrefFor,
  liveSessionIds,
}: {
  rows: LoginEventRow[]
  page: number
  pages: number
  hrefFor: (page: number) => string
  liveSessionIds: ReadonlySet<string>
}) {
  const m = adminMessages.admin.users
  return (
    <Panel className="p-0 md:px-0">
      <div className="px-5 pt-4">
        <PanelHeader title={m.loginHistory} hint={m.loginHistoryHint} />
      </div>
      <Table className="rounded-none border-0 border-t">
        <thead>
          <tr>
            <Th>{m.colWhen}</Th>
            <Th>{m.colDevice}</Th>
            <Th>{m.colWhere}</Th>
            <Th>{m.colMethod}</Th>
            <Th align="right">{m.colOutcome}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <EmptyRow colSpan={5}>{m.noHistory}</EmptyRow> : null}
          {rows.map((r) => (
            <tr key={r.id}>
              <Td className="text-fg-muted">
                <When date={r.at} />
              </Td>
              <Td>
                <span className="font-semibold">{deviceLabel(r)}</span>
                {r.device && r.device !== 'Desktop' ? (
                  <span className="ml-2 text-[12px] text-fg-subtle">{r.device}</span>
                ) : null}
                {r.sessionId && liveSessionIds.has(r.sessionId) ? (
                  <Pill tone="brand" className="ml-2">
                    {m.thisSession}
                  </Pill>
                ) : null}
              </Td>
              <Td className="text-fg-muted">{formatPlace(r) ?? '—'}</Td>
              <Td className="text-fg-muted">{methodLabel(r.method)}</Td>
              <Td align="right">
                <Pill tone={outcomeTone[r.outcome] ?? 'neutral'}>{outcomeLabel(r.outcome)}</Pill>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="px-5 pb-4">
        <Pagination page={page} pages={pages} hrefFor={hrefFor} />
      </div>
    </Panel>
  )
}
