import { auditLog, getDb, users } from '@palscans/db'
import { and, count, desc, eq, gte, ilike, lte } from 'drizzle-orm'
import { PAGE_SIZE } from './params'

export interface AuditParams {
  actor?: string
  action?: string
  target?: string
  targetId?: number
  from?: string
  to?: string
  page: number
}

export const loadAuditLog = async (p: AuditParams) => {
  const db = await getDb()
  const where = and(
    p.action ? ilike(auditLog.action, `${p.action}%`) : undefined,
    p.target ? eq(auditLog.targetType, p.target) : undefined,
    p.targetId ? eq(auditLog.targetId, p.targetId) : undefined,
    p.actor ? ilike(users.username, `%${p.actor}%`) : undefined,
    p.from ? gte(auditLog.createdAt, new Date(p.from)) : undefined,
    p.to ? lte(auditLog.createdAt, new Date(`${p.to}T23:59:59Z`)) : undefined,
  )
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        targetType: auditLog.targetType,
        targetId: auditLog.targetId,
        before: auditLog.before,
        after: auditLog.after,
        createdAt: auditLog.createdAt,
        actor: users.username,
        actorId: auditLog.actorId,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorId))
      .where(where)
      .orderBy(desc(auditLog.createdAt))
      .limit(PAGE_SIZE)
      .offset((p.page - 1) * PAGE_SIZE),
    db
      .select({ n: count() })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorId))
      .where(where),
  ])
  return { rows, total: total?.n ?? 0, pages: Math.max(1, Math.ceil((total?.n ?? 0) / PAGE_SIZE)) }
}

/** Flatten two JSON values into a key → [before, after] table of changed paths. */
export const diffJson = (
  before: unknown,
  after: unknown,
): Array<{ path: string; before: string; after: string }> => {
  const flat = (
    v: unknown,
    prefix = '',
    out: Record<string, string> = {},
  ): Record<string, string> => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k, x] of Object.entries(v as Record<string, unknown>))
        flat(x, prefix ? `${prefix}.${k}` : k, out)
    } else if (prefix)
      out[prefix] = v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v)
    return out
  }
  const a = flat(before)
  const b = flat(after)
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
  return keys
    .filter((k) => a[k] !== b[k])
    .map((k) => ({ path: k, before: a[k] ?? '', after: b[k] ?? '' }))
}
