import { auditLog, getDb } from '@palscans/db'

/**
 * Every mutating admin action writes an `audit_log` row (docs/16 conventions, docs/04
 * "Audit log"): actor, action, target and a before/after snapshot the viewer diffs.
 *
 * What it does *not* record is where the actor was. The row used to carry an `ip_hash`;
 * migration 9038 dropped the column, because an HMAC of an IPv4 address is reversible by
 * anyone holding the app secret and the whole 2^32 space, which made it a location record
 * for every member of staff rather than the abuse handle it was meant to be.
 */
export interface AuditInput {
  actorId: number
  action: string
  targetType: string
  targetId?: number | null
  before?: unknown
  after?: unknown
}

export const audit = async (input: AuditInput): Promise<void> => {
  const db = await getDb()
  await db.insert(auditLog).values({
    actorId: input.actorId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
  })
}

/** Pick a stable subset of a row for before/after snapshots (Dates → ISO). */
export const snapshot = <T extends Record<string, unknown>>(
  row: T | null | undefined,
  keys?: readonly (keyof T)[],
): Record<string, unknown> | null => {
  if (!row) return null
  const out: Record<string, unknown> = {}
  for (const k of keys ?? (Object.keys(row) as (keyof T)[])) {
    const v = row[k]
    out[String(k)] = v instanceof Date ? v.toISOString() : v
  }
  return out
}
