import { getDb } from '@palscans/db'
import { sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'

/**
 * GET /api/health — for uptime monitors and container health checks.
 *
 * Deliberately shallow: it answers "can this process serve a request that touches the
 * database", not "is every integration configured". A monitor that goes red because Stripe
 * keys are missing teaches people to ignore it, so integration state belongs on the
 * Integrations screen, not here.
 *
 * 200 when the database answers, 503 when it does not. No authentication, and no detail
 * beyond that — the response is public, so it must not describe the infrastructure.
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(): Promise<NextResponse> {
  const startedAt = Date.now()
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
