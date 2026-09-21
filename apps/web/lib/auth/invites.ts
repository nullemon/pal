import { randomInt } from 'node:crypto'
import { getDb, getSetting, inviteCodes, settings } from '@palscans/db'
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'

/**
 * docs/17 §C — operator-controlled access to registration: the domain allow/block list, the
 * require-verification and Turnstile switches (`settings.access`), and the invite codes the
 * register route enforces when `settings.site.registration` is `invite`.
 *
 * The registration *mode* itself stays where it already lives, `settings.site.registration`;
 * nothing here duplicates it.
 */

/* ------------------------------------------------------------------ settings */

export const ACCESS_SETTING_KEY = 'access'

export const domainModeSchema = z.enum(['off', 'allow', 'block'])
export type DomainMode = z.infer<typeof domainModeSchema>

/**
 * Where the staff sign-in answers. Moving it off the default trims the automated scanner
 * traffic that hammers well-known admin paths — it is noise reduction, not access control,
 * so it sits alongside `panel_ips` and the mandatory TOTP rather than replacing them.
 */
export const STAFF_PATH_DEFAULT = '/admin/login'

const RESERVED_STAFF_PATHS = new Set([
  '/',
  '/admin',
  '/login',
  '/register',
  '/browse',
  '/search',
  '/series',
  '/genres',
  '/rankings',
  '/subscribe',
  '/me',
  '/api',
])

export const staffPathSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .transform((v) => (v.startsWith('/') ? v : `/${v}`))
  .transform((v) => (v.length > 1 && v.endsWith('/') ? v.slice(0, -1) : v))
  .refine((v) => /^\/[a-z0-9][a-z0-9/_-]*$/i.test(v), 'letters, digits, - _ and / only')
  .refine((v) => !v.includes('//') && !v.includes('..'), 'no empty or relative segments')
  .refine(
    (v) => !RESERVED_STAFF_PATHS.has(v) && !v.startsWith('/api/'),
    'that path belongs to the site',
  )

export const accessSettingSchema = z.object({
  domain_mode: domainModeSchema,
  domains: z.array(z.string().trim().max(253)).max(200),
  require_verification: z.boolean(),
  turnstile: z.boolean(),
  /** Custom staff sign-in path; the default is served when this equals it. */
  staff_path: staffPathSchema.catch(STAFF_PATH_DEFAULT),
  /**
   * When non-empty, only these IPs and CIDR ranges reach the panel at all — the real
   * restriction. Needs TRUSTED_PROXY set, or every request looks like the proxy's own IP.
   */
  panel_ips: z.array(z.string().trim().max(64)).max(100),
  /**
   * Whether an admin must hold a second factor before the panel opens (docs/07).
   *
   * On by default, and worth leaving on: an admin password is one reused credential away
   * from someone owning the whole site. It is a setting rather than a rule because a fresh
   * deployment has no readers to protect and an operator who wants to look around first is
   * making a real, reversible choice about their own risk — a wall they cannot pass just
   * teaches them to look for a way round it.
   */
  staff_totp: z.boolean(),
})
export type AccessSetting = z.infer<typeof accessSettingSchema>

export const DEFAULT_ACCESS: AccessSetting = {
  domain_mode: 'off',
  domains: [],
  require_verification: false,
  turnstile: true,
  staff_path: STAFF_PATH_DEFAULT,
  panel_ips: [],
  staff_totp: true,
}

export const readAccessSetting = async (): Promise<AccessSetting> => {
  const db = await getDb()
  const raw = await getSetting<Record<string, unknown>>(db, ACCESS_SETTING_KEY, {})
  const parsed = accessSettingSchema.safeParse({ ...DEFAULT_ACCESS, ...raw })
  return parsed.success ? parsed.data : DEFAULT_ACCESS
}

export type RegistrationMode = 'open' | 'invite' | 'closed'

export const readRegistrationMode = async (): Promise<RegistrationMode> => {
  const db = await getDb()
  const site = await getSetting<Record<string, unknown>>(db, 'site', {})
  const mode = site.registration
  return mode === 'invite' || mode === 'closed' ? mode : 'open'
}

/** The comment-settings value docs/17 asks to be surfaced on this screen as well. */
export const readMinAccountAgeMinutes = async (): Promise<number> => {
  const db = await getDb()
  const comments = await getSetting<Record<string, unknown>>(db, 'comments', {})
  const raw = comments.min_account_age_minutes
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0
}

/** Merge one key into `settings.comments` without disturbing the rest of that document. */
export const writeMinAccountAgeMinutes = async (
  minutes: number,
  actorId: number,
): Promise<void> => {
  const db = await getDb()
  const before = await getSetting<Record<string, unknown>>(db, 'comments', {})
  const value = { ...before, min_account_age_minutes: minutes }
  const now = new Date()
  await db
    .insert(settings)
    .values({ key: 'comments', value, updatedBy: actorId, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedBy: actorId, updatedAt: now },
    })
}

/* -------------------------------------------------------------- domain rules */

/** `@Example.COM.` and `example.com` are the same rule; blanks are dropped. */
export const normaliseDomain = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/^\.+|\.+$/g, '')

export const normaliseDomains = (values: readonly string[]): string[] => {
  const out: string[] = []
  for (const v of values) {
    const d = normaliseDomain(v)
    if (d && !out.includes(d)) out.push(d)
  }
  return out
}

export const emailDomain = (email: string): string =>
  email.trim().toLowerCase().split('@').pop() ?? ''

/** A rule matches its own domain and anything under it: `example.com` covers `mail.example.com`. */
export const domainMatches = (domain: string, rule: string): boolean =>
  domain === rule || domain.endsWith(`.${rule}`)

/**
 * Whether an address may register. An *empty* allow list means "off" rather than "nobody" —
 * saving the screen with the mode set and no domains yet must not lock the site.
 */
export const emailAllowed = (
  email: string,
  rules: Pick<AccessSetting, 'domain_mode' | 'domains'>,
): boolean => {
  const list = normaliseDomains(rules.domains)
  if (rules.domain_mode === 'off' || list.length === 0) return true
  const domain = emailDomain(email)
  if (!domain) return false
  const matched = list.some((rule) => domainMatches(domain, rule))
  return rules.domain_mode === 'allow' ? matched : !matched
}

/* ------------------------------------------------------------- invite codes */

/** No 0/O/1/I: codes are read off a screen and typed by hand. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export const generateInviteCode = (): string => {
  const block = (n: number) =>
    Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
  return `${block(4)}-${block(4)}`
}

export const inviteCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(4)
  .max(32)
  .regex(/^[A-Z0-9-]+$/)

export interface InviteRow {
  id: number
  code: string
  maxUses: number
  uses: number
  note: string | null
  expiresAt: Date | null
  lastUsedAt: Date | null
  createdAt: Date
  revokedAt: Date | null
  createdBy: number | null
}

export type InviteState = 'active' | 'revoked' | 'expired' | 'used'

/** Pure: what an invite row is right now. */
export const inviteState = (
  row: Pick<InviteRow, 'uses' | 'maxUses' | 'expiresAt' | 'revokedAt'>,
  now: Date = new Date(),
): InviteState => {
  if (row.revokedAt) return 'revoked'
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return 'expired'
  if (row.uses >= row.maxUses) return 'used'
  return 'active'
}

export const inviteUsable = (
  row: Pick<InviteRow, 'uses' | 'maxUses' | 'expiresAt' | 'revokedAt'>,
  now: Date = new Date(),
): boolean => inviteState(row, now) === 'active'

export const createInviteSchema = z.object({
  maxUses: z.number().int().min(1).max(1000),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
  note: z.string().trim().max(120).nullable(),
})
export type CreateInviteInput = z.infer<typeof createInviteSchema>

export const createInvite = async (
  input: CreateInviteInput,
  actorId: number,
): Promise<InviteRow> => {
  const db = await getDb()
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateInviteCode()
    const [row] = await db
      .insert(inviteCodes)
      .values({
        code,
        maxUses: input.maxUses,
        note: input.note,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        createdBy: actorId,
      })
      .onConflictDoNothing({ target: inviteCodes.code })
      .returning()
    if (row) return row
  }
  throw new Error('invite_code_collision')
}

export const listInvites = async (limit = 50): Promise<InviteRow[]> => {
  const db = await getDb()
  return db.select().from(inviteCodes).orderBy(desc(inviteCodes.createdAt)).limit(limit)
}

export const findInvite = async (id: number): Promise<InviteRow | null> => {
  const db = await getDb()
  const [row] = await db.select().from(inviteCodes).where(eq(inviteCodes.id, id)).limit(1)
  return row ?? null
}

/** Revoked, never deleted (docs/16): the row and its use count stay for the audit trail. */
export const revokeInvite = async (id: number): Promise<InviteRow | null> => {
  const db = await getDb()
  const [row] = await db
    .update(inviteCodes)
    .set({ revokedAt: new Date() })
    .where(and(eq(inviteCodes.id, id), isNull(inviteCodes.revokedAt)))
    .returning()
  return row ?? null
}

/**
 * Claim one use, atomically: the `uses < max_uses` guard lives in the UPDATE, so two people
 * racing on the last use of a code cannot both get in.
 */
export const redeemInvite = async (
  code: string,
  now: Date = new Date(),
): Promise<InviteRow | null> => {
  const db = await getDb()
  const [row] = await db
    .update(inviteCodes)
    .set({ uses: sql`${inviteCodes.uses} + 1`, lastUsedAt: now })
    .where(
      and(
        eq(inviteCodes.code, code),
        isNull(inviteCodes.revokedAt),
        sql`${inviteCodes.uses} < ${inviteCodes.maxUses}`,
        or(isNull(inviteCodes.expiresAt), sql`${inviteCodes.expiresAt} > ${now}`),
      ),
    )
    .returning()
  return row ?? null
}

/* ---------------------------------------------------------- registration gate */

export interface RegistrationGateInput {
  email: string
  /** The code typed on the register form; required only when the mode is `invite`. */
  invite?: string
  turnstileToken?: string
  ip: string | null
}

export type RegistrationGate =
  | { ok: true; access: AccessSetting; mode: RegistrationMode; invite: string | null }
  | { ok: false; status: number; error: string; message: string }

/**
 * Everything the operator controls about who may create an account, checked in one place so
 * the register route only has to ask once: the registration mode, the domain list, Turnstile
 * (on/off here, configured or not in the environment) and the invite code.
 *
 * The invite is validated but **not** consumed — `redeemInvite` claims the use once the rest
 * of registration has passed, so a rejected password never burns a single-use code.
 */
export const checkRegistrationAccess = async (
  input: RegistrationGateInput,
): Promise<RegistrationGate> => {
  const { messages } = await import('@palscans/core/messages')
  const [mode, access] = await Promise.all([readRegistrationMode(), readAccessSetting()])
  if (mode === 'closed')
    return {
      ok: false,
      status: 403,
      error: 'registration_closed',
      message: messages.auth.registrationClosed,
    }
  if (!emailAllowed(input.email, access))
    return {
      ok: false,
      status: 403,
      error: 'domain_not_allowed',
      message: messages.auth.domainNotAllowed,
    }
  if (access.turnstile) {
    const { verifyTurnstile } = await import('./turnstile')
    if (!(await verifyTurnstile(input.turnstileToken, input.ip)))
      return { ok: false, status: 400, error: 'turnstile', message: messages.errors.validation }
  }
  if (mode !== 'invite') return { ok: true, access, mode, invite: null }

  const parsed = inviteCodeSchema.safeParse(input.invite ?? '')
  if (!parsed.success)
    return {
      ok: false,
      status: 403,
      error: 'invite_required',
      message: messages.auth.inviteRequired,
    }
  const db = await getDb()
  const [row] = await db
    .select()
    .from(inviteCodes)
    .where(eq(inviteCodes.code, parsed.data))
    .limit(1)
  if (!row || !inviteUsable(row))
    return { ok: false, status: 403, error: 'invite_invalid', message: messages.auth.inviteInvalid }
  return { ok: true, access, mode, invite: parsed.data }
}
