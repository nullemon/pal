import { bans, escapeLike, getDb, users } from '@palscans/db'
import { and, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '@/components/admin/server/audit'
import { parseQuery, withPermission } from '@/lib/auth'

/** One CSV field: quote everything, double the quotes, and never let a value start a formula. */
const cell = (value: unknown): string => {
  const raw =
    value === null || value === undefined
      ? ''
      : value instanceof Date
        ? value.toISOString()
        : String(value)
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
  return `"${safe.replaceAll('"', '""')}"`
}

const querySchema = z.object({
  q: z.string().trim().max(120).optional(),
  /** Comma-separated ids: the current selection. Absent means "everything the search matches". */
  ids: z.string().max(4000).optional(),
})

const MAX_ROWS = 5000

/**
 * GET /api/admin/users/export — docs/17 §C. The users list's selection (or the whole result
 * of the current search) as CSV. A read, but of personal data, so it is audited like a
 * mutation.
 */
export const GET = withPermission('user.read', async (request, _ctx, actor) => {
  const parsed = parseQuery(request, querySchema)
  if (!parsed.ok) return parsed.response
  const { q } = parsed.data
  const ids = (parsed.data.ids ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, MAX_ROWS)
  const numeric = q && /^\d+$/.test(q) ? Number(q) : null
  const where = and(
    isNull(users.deletedAt),
    ids.length > 0 ? inArray(users.id, ids) : undefined,
    q
      ? or(
          ilike(users.email, `%${escapeLike(q)}%`),
          ilike(users.username, `%${escapeLike(q)}%`),
          numeric ? eq(users.id, numeric) : undefined,
        )
      : undefined,
  )
  const db = await getDb()
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      username: users.username,
      role: users.role,
      emailVerifiedAt: users.emailVerifiedAt,
      commentBannedUntil: users.commentBannedUntil,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
      lastLoginMethod: users.lastLoginMethod,
      banned: sql<boolean>`exists(select 1 from ${bans} where ${bans.kind} = 'user' and ${bans.value} = ${users.id}::text and ${bans.revokedAt} is null and (${bans.expiresAt} is null or ${bans.expiresAt} > now()))`,
    })
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt))
    .limit(MAX_ROWS)

  const header = [
    'id',
    'email',
    'username',
    'role',
    'verified_at',
    'banned',
    'comment_banned_until',
    'created_at',
    'last_login_at',
    'last_login_method',
  ]
  const body = rows.map((r) =>
    [
      r.id,
      r.email,
      r.username,
      r.role,
      r.emailVerifiedAt,
      r.banned ? 'yes' : 'no',
      r.commentBannedUntil,
      r.createdAt,
      r.lastLoginAt,
      r.lastLoginMethod,
    ]
      .map(cell)
      .join(','),
  )
  const csv = `﻿${[header.map(cell).join(','), ...body].join('\r\n')}\r\n`

  await audit({
    actorId: actor.id,
    action: 'user.export',
    targetType: 'user',
    after: { rows: rows.length, query: q ?? null, selection: ids.length || null },
    request,
  })

  const stamp = new Date().toISOString().slice(0, 10)
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="palscans-users-${stamp}.csv"`,
      'cache-control': 'no-store',
    },
  })
})
