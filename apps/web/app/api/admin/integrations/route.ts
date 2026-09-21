import { adminMessages } from '@palscans/core/messages/admin'
import { getDb, users } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { audit } from '@/components/admin/server/audit'
import { fail, getRateLimiter, ok, parseJson, rateLimited, withPermission } from '@/lib/auth'
import { integrationsPutSchema, integrationsTestSchema } from '@/lib/config/panel'
import { refreshConfigSnapshot } from '@/lib/config/snapshot'
import { configView, writeConfig } from '@/lib/config/store'
import { mergeSubmitted, runConnectionTest } from '@/lib/config/tests'

/**
 * Admin → System → Integrations (docs/19).
 *
 * `PUT` stores credentials, `POST` proves them against the real provider. Both carry values
 * the operator typed, which sets the rules this file works under:
 *
 * - the response is always the panel view, so a secret is only ever echoed back as a mask
 * - the audit row records **which** field ids changed and nothing else — a before/after
 *   snapshot here would put an R2 key into a table the panel renders
 * - nothing is logged; the test runner catches its own failures for the same reason
 */

export const PUT = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, integrationsPutSchema)
  if (!parsed.ok) return parsed.response

  let changed: string[]
  try {
    changed = await writeConfig(parsed.data.values, user.id)
  } catch {
    // The only expected failure is a missing sealing key, which the screen already warns
    // about; the message names the fix rather than the exception.
    return fail(503, 'sealing_key_missing', adminMessages.admin.integrations.sealing.missingBody)
  }

  // Next 16 wants a cache-life profile alongside the tag; 'max' expires it everywhere.
  // `writeConfig` has already dropped the credential memo — it is in-process and never
  // touches Next's cache, which would write the decrypted values to disk (lib/config/store.ts).
  // This re-reads the two mirrored values so the next render uses them.
  await refreshConfigSnapshot()
  const view = await configView()

  if (changed.length > 0)
    await audit({
      actorId: user.id,
      action: 'settings.integrations',
      targetType: 'settings',
      // Ids only. Never a value, masked or otherwise.
      after: { changed },
    })

  return ok(view)
})

/**
 * `POST` runs one group's connection test against the submitted values, so a credential can
 * be proved before it is stored. Rate limited per admin because each run reaches a third
 * party and, for mail, actually sends a message.
 */
export const POST = withPermission('settings.write', async (request, _ctx, user) => {
  const parsed = await parseJson(request, integrationsTestSchema)
  if (!parsed.ok) return parsed.response

  const hit = await getRateLimiter().hit(`integrations-test:${user.id}`, 20, 300)
  if (!hit.ok) return rateLimited(hit.retryAfterSec)

  const db = await getDb()
  const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, user.id))
  if (!row) return fail(404, 'not_found')

  const { values, withheld } = await mergeSubmitted(parsed.data.values)
  const report = await runConnectionTest(parsed.data.group, values, { email: row.email }, withheld)

  await audit({
    actorId: user.id,
    action: 'settings.integrations.test',
    targetType: 'settings',
    after: { group: report.group, ok: report.ok },
  })
  return ok(report)
})
