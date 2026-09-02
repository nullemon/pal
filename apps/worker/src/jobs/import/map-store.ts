import { createHash } from 'node:crypto'
import { type Db, type ImportMapKind, importMap } from '@palscans/db'
import { and, eq, inArray } from 'drizzle-orm'

/**
 * The legacy → local id table (migration 9012). Every writer goes through it, which is what
 * makes a second import an update rather than a duplicate: the run looks the legacy id up,
 * and when the stored digest still matches the mapped payload it skips the row untouched.
 */

/** Stable hash of a mapped payload. Key order is normalised so re-runs compare equal. */
export const digestOf = (value: unknown): string =>
  createHash('sha256').update(stableJson(value)).digest('hex').slice(0, 32)

const stableJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`
}

export interface MappedRef {
  targetId: number
  digest: string | null
}

/** Load the mappings for one batch of legacy ids in a single query. */
export const loadMappings = async (
  db: Db,
  kind: ImportMapKind,
  legacyIds: readonly number[],
): Promise<Map<number, MappedRef>> => {
  const out = new Map<number, MappedRef>()
  if (legacyIds.length === 0) return out
  const rows = await db
    .select({
      legacyId: importMap.legacyId,
      targetId: importMap.targetId,
      digest: importMap.digest,
    })
    .from(importMap)
    .where(and(eq(importMap.kind, kind), inArray(importMap.legacyId, [...legacyIds])))
  for (const r of rows) out.set(r.legacyId, { targetId: r.targetId, digest: r.digest })
  return out
}

export const rememberMapping = async (
  tx: Db,
  kind: ImportMapKind,
  legacyId: number,
  targetId: number,
  digest: string,
  now: Date,
): Promise<void> => {
  await tx
    .insert(importMap)
    .values({ kind, legacyId, targetId, digest, importedAt: now })
    .onConflictDoUpdate({
      target: [importMap.kind, importMap.legacyId],
      set: { targetId, digest, importedAt: now },
    })
}
