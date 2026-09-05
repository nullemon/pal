import { can } from '@palscans/core'
import { adminMessages } from '@palscans/core/messages/admin'
import { z } from 'zod'
import { ReleaseCalendar } from '@/components/admin/client/ReleaseCalendar'
import { loadCalendar } from '@/components/admin/server/calendar'
import { parseSearch, type SearchParams } from '@/components/admin/server/params'
import { PageHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'
import { siteFormatting } from '@/lib/copy/settings'
import { addDays, buildGrid, dayKey, parseAnchor } from './grid'

const schema = z.object({
  view: z.enum(['week', 'month']).default('week').catch('week'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
  series: z.coerce.number().int().positive().optional().catch(undefined),
})

/**
 * Admin → Chapters → Calendar (docs/04 "Scheduling"): a week or a month of what publishes
 * when, across every series, beside the finished chapters that have no date at all.
 *
 * The server only picks the *rows*: the grid itself is drawn in the browser's timezone, so
 * a 09:00 Monday release never shows up on Sunday for an operator in another country. The
 * fetch window is the grid plus two days of slack to cover that difference.
 */
export default async function ReleaseCalendarPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const user = await withPermission('chapter.read', { returnTo: '/admin/chapters/calendar' })
  const p = parseSearch(schema, await searchParams)
  const anchor = parseAnchor(p.date)
  // Appearance → Formatting → Week starts on (docs/15). The server picks the fetch window
  // from the same grid the browser draws, so both have to agree on which day is first.
  const { weekStartsOn } = await siteFormatting()
  const grid = buildGrid(p.view, anchor, weekStartsOn)
  const data = await loadCalendar(addDays(grid.start, -2), addDays(grid.end, 2), p.series)
  const m = adminMessages.calendar
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <ReleaseCalendar
        view={p.view}
        anchor={dayKey(anchor)}
        data={data}
        canPublish={can(user, 'chapter.publish')}
        weekStartsOn={weekStartsOn}
      />
    </>
  )
}
