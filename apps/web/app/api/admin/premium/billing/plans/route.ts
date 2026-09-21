import { getDb, plans } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { plansInput } from '@/components/admin/premium/billing-schemas'
import { audit, snapshot } from '@/components/admin/server/audit'
import { purgeSettings } from '@/components/admin/server/cache'
import { fail, ok, parseJson, withPermission } from '@/lib/auth'

/**
 * `PUT /api/admin/premium/billing/plans` — the price behind each tier and what it unlocks.
 * Plans are never created or deleted here: the two seeded tiers are the product (docs/07 "Two
 * tiers is the right number"), so this only updates rows that already exist.
 */
export const PUT = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, plansInput)
  if (!parsed.ok) return parsed.response
  const db = await getDb()
  const existing = await db.select().from(plans)
  const byId = new Map(existing.map((p) => [p.id, p]))
  for (const row of parsed.data.plans) if (!byId.has(row.id)) return fail(404, 'plan_not_found')

  for (const row of parsed.data.plans) {
    const before = byId.get(row.id)
    if (!before) continue
    await db
      .update(plans)
      .set({
        name: row.name,
        priceCents: row.priceCents,
        interval: row.interval,
        stripePriceId: row.stripePriceId,
        features: row.features,
        active: row.active,
      })
      .where(eq(plans.id, row.id))
    await audit({
      actorId: user.id,
      action: 'billing.plan_update',
      targetType: 'plan',
      before: snapshot(before),
      after: row,
    })
  }
  purgeSettings()
  revalidatePath('/subscribe')
  return ok(parsed.data)
})
