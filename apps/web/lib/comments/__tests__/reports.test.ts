import { createDb, type DbHandle, reports, runMigrations, users } from '@palscans/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isDeprioritisedReporter, REPORTER_REJECTED_LIMIT } from '../queries'

const now = new Date('2026-09-02T12:00:00Z')
const DAY = 86_400_000
const daysAgo = (n: number) => new Date(now.getTime() - n * DAY)

let handle: DbHandle
beforeAll(async () => {
  handle = await createDb('pglite://memory')
  await runMigrations(handle)
}, 120_000)
afterAll(async () => {
  await handle?.close()
})

const report = (
  reporterId: number,
  status: 'open' | 'actioned' | 'rejected',
  handledAt: Date | null,
) => ({
  kind: 'comment',
  targetType: 'comment',
  targetId: 1,
  reporterId,
  reason: 'spam',
  status,
  handledAt,
})

describe('isDeprioritisedReporter (docs/14 §6)', () => {
  it('counts only rejected reports handled inside the 30-day window', async () => {
    const db = handle.db
    const [a, b] = await db
      .insert(users)
      .values([{ email: 'a@reports.test' }, { email: 'b@reports.test' }])
      .returning({ id: users.id })
    if (!a || !b) throw new Error('users not inserted')
    await db.insert(reports).values([
      ...Array.from({ length: REPORTER_REJECTED_LIMIT - 1 }, (_, i) =>
        report(a.id, 'rejected', daysAgo(i + 1)),
      ),
      report(a.id, 'rejected', daysAgo(31)), // outside the window
      report(a.id, 'actioned', daysAgo(1)), // not a rejection
      report(a.id, 'open', null),
      ...Array.from({ length: REPORTER_REJECTED_LIMIT }, (_, i) =>
        report(b.id, 'rejected', daysAgo(i + 1)),
      ),
    ])
    expect(await isDeprioritisedReporter(db, a.id, now)).toBe(false)
    expect(await isDeprioritisedReporter(db, b.id, now)).toBe(true)
    // the fifth rejection inside the window tips a reporter over
    await db.insert(reports).values(report(a.id, 'rejected', daysAgo(29)))
    expect(await isDeprioritisedReporter(db, a.id, now)).toBe(true)
    // no history at all → trusted
    expect(await isDeprioritisedReporter(db, 999_999, now)).toBe(false)
  }, 30_000)
})
