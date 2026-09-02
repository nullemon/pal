import { messages } from '@palscans/core/messages'
import { z } from 'zod'

/** Every auth/account input, validated with zod (docs/16). */
export const emailSchema = z.string().trim().toLowerCase().email().max(254)

/** docs/07 + messages.auth.weakPassword: at least 10 characters. */
export const passwordSchema = z.string().min(10).max(200)

export const USERNAME_RE = /^[a-z0-9](?:[a-z0-9_]{1,22})[a-z0-9]$/i
export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(24)
  .regex(USERNAME_RE, messages.auth.usernameRule)

/** Names no account may take: routes and staff words. */
export const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'mod',
  'moderator',
  'staff',
  'palscans',
  'me',
  'login',
  'register',
  'api',
  'settings',
  'support',
  'system',
  'root',
  'null',
  'undefined',
])

export const returnSchema = z.string().max(2000).optional()

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  username: usernameSchema.optional(),
  return: returnSchema,
  /** Cloudflare Turnstile token (docs/13); verified when TURNSTILE_SECRET_KEY is set. */
  turnstile: z.string().max(4096).optional(),
  /** docs/17 §C: required only while `settings.site.registration` is `invite`. */
  invite: z.string().trim().max(32).optional(),
})

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
  return: returnSchema,
  turnstile: z.string().max(4096).optional(),
})

export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, messages.authPage.totpCodeRule)

export const loginTotpSchema = z.object({ code: totpCodeSchema, return: returnSchema })

export const forgotSchema = z.object({ email: emailSchema })

export const resetSchema = z.object({ token: z.string().min(32).max(64), password: passwordSchema })

export const verifyQuerySchema = z.object({ token: z.string().min(32).max(64) })

export const onboardingSchema = z.object({ username: usernameSchema, return: returnSchema })

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(200), password: passwordSchema })
  .refine((v) => v.currentPassword !== v.password, {
    message: messages.me.security.samePassword,
    path: ['password'],
  })

export const profileSchema = z.object({
  displayName: z.string().trim().max(40).optional(),
  bio: z.string().trim().max(300).optional(),
  safeMode: z.boolean().optional(),
})

export const usernameChangeSchema = z.object({ username: usernameSchema })

export const themeSchema = z.object({ theme: z.enum(['dark', 'light', 'system']) })

export const avatarPresignSchema = z.object({
  contentType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  size: z
    .number()
    .int()
    .positive()
    .max(2 * 1024 * 1024),
})

export const avatarConfirmSchema = z.object({ key: z.string().min(1).max(200) })

export const totpConfirmSchema = z.object({ code: totpCodeSchema })
/**
 * Turning TOTP off re-authenticates: the password for password accounts, a current code
 * for OAuth-only accounts (docs/07 — never a bare request). The route decides which applies.
 */
export const totpDisableSchema = z.object({
  password: z.string().max(200).optional(),
  code: totpCodeSchema.optional(),
})

export const deleteAccountSchema = z.object({ password: z.string().max(200).optional() })

export const notificationsReadSchema = z.object({
  ids: z.array(z.number().int().positive()).max(200).optional(),
})

export const NOTIFICATION_KINDS = ['new_chapter', 'reply', 'reaction', 'announcement'] as const
export const NOTIFICATION_CHANNELS = ['in_app', 'push', 'email', 'discord'] as const

export const notificationPrefsSchema = z.object({
  prefs: z
    .array(
      z.object({
        kind: z.enum(NOTIFICATION_KINDS),
        channel: z.enum(NOTIFICATION_CHANNELS),
        enabled: z.boolean(),
      }),
    )
    .max(NOTIFICATION_KINDS.length * NOTIFICATION_CHANNELS.length),
})

export const BOOKMARK_STATUSES = ['reading', 'planned', 'completed', 'paused', 'dropped'] as const
export type BookmarkStatus = (typeof BOOKMARK_STATUSES)[number]

export const bookmarksQuerySchema = z.object({
  status: z.enum(BOOKMARK_STATUSES).optional(),
  kind: z.enum(['comics', 'novels']).default('comics'),
  page: z.coerce.number().int().min(1).max(500).default(1),
})

export const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(500).default(1),
})
