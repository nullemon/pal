import { getDb } from '@palscans/db'
import { sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getEnv } from '@/lib/env'

/**
 * GET /api/health — for uptime monitors and container health checks.
 *
 * Deliberately shallow: it answers "can this process serve a request that touches the
 * database", not "is every integration configured". A monitor that goes red because Stripe
 * keys are missing teaches people to ignore it, so integration state belongs on the
 * Integrations screen, not here.
 *
 * 200 when the database answers *and the environment parses*, 503 when either does not. No
 * authentication, and no detail beyond that — the response is public, so it must not
 * describe the infrastructure.
 *
 * The environment check is not a widening of the contract above, it is the contract: an
 * invalid environment makes `getEnv()` throw inside every page render, so the process cannot
 * serve a request at all. That is what this endpoint claims to answer, and it did not. It was
 * found by deploying with `TRUSTED_PROXY` unset: every page answered 500, this answered
 * `{"status":"ok"}`, and the container health check stayed green — so nothing restarted, no
 * monitor fired, and the only symptom was a site that was entirely down.
 *
 * It costs nothing to ask: `getEnv()` is memoised after the first call, so this is a property
 * read on every request but the first.
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(): Promise<NextResponse> {
  const startedAt = Date.now()
  try {
    // Before the database: a process whose environment will not parse cannot render a page
    // whatever the database says, and reporting `db: up` for it is how a total outage looks
    // healthy. `env: 'bad'` rather than the reason — the response is public.
    getEnv()
  } catch {
    return NextResponse.json(
      { status: 'degraded', env: 'bad', ms: Date.now() - startedAt },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }
  try {
    const db = await getDb()
    await db.execute(sql`select 1`)
    return NextResponse.json(
      { status: 'ok', db: 'up', ms: Date.now() - startedAt },
      { headers: { 'cache-control': 'no-store' } },
    )
  } catch {
    return NextResponse.json(
      { status: 'degraded', db: 'down', ms: Date.now() - startedAt },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }
}
