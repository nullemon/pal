import { fmt, messages } from '@palscans/core/messages'
import type { ReadingMonth } from '@palscans/db'

/**
 * Chapters opened per month over the last year.
 *
 * Server-rendered CSS bars, no charting library and no client JavaScript: twelve numbers do
 * not justify shipping a renderer to a phone (docs/06 performance budgets). The same
 * numbers are in a visually-hidden table, so the figure is readable by a screen reader
 * instead of being an unlabelled row of boxes.
 */
export function ReadingActivity({ months }: { months: readonly ReadingMonth[] }) {
  const m = messages.me.stats
  const peak = Math.max(1, ...months.map((month) => month.chapters))
  const total = months.reduce((sum, month) => sum + month.chapters, 0)
  const label = (month: string) => {
    const [year, mm] = month.split('-')
    const at = new Date(Date.UTC(Number(year), Number(mm) - 1, 1))
    return at.toLocaleDateString('en', { month: 'short', timeZone: 'UTC' })
  }

  if (total === 0) return <p className="text-[13px] text-fg-muted">{m.noActivity}</p>

  return (
    <figure className="m-0">
      <div className="flex h-44 gap-1.5 sm:gap-2" aria-hidden="true">
        {months.map((month) => (
          <div key={month.month} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <span className="h-4 text-[11px] font-bold leading-4 tabular-nums text-fg-subtle">
              {month.chapters || ''}
            </span>
            {/* The bar's percentage height needs a parent with a definite one: this track
                gets it from `flex-1` inside the fixed-height row above. */}
            <div className="relative w-full flex-1">
              <span
                className="absolute inset-x-0 bottom-0 rounded-t-sm bg-brand/70"
                style={{
                  height: `${Math.max(month.chapters === 0 ? 2 : 6, (month.chapters / peak) * 100)}%`,
                }}
                title={fmt(m.activityMonth, { month: month.month, n: month.chapters })}
              />
            </div>
            <span className="h-4 w-full truncate text-center text-[11px] leading-4 text-fg-muted">
              {label(month.month)}
            </span>
          </div>
        ))}
      </div>
      <figcaption className="sr-only">
        <table>
          <caption>{m.activityHint}</caption>
          <tbody>
            {months.map((month) => (
              <tr key={month.month}>
                <th scope="row">{month.month}</th>
                <td>{fmt(m.chaptersCount, { n: month.chapters })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  )
}
