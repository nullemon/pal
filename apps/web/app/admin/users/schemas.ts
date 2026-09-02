import type { Feature, Role } from '@palscans/core'
import { z } from 'zod'

/**
 * docs/17 §C — the shapes the users list's bulk bar and the "new user" screen post.
 *
 * The role and feature lists are spelled out here rather than imported from `@palscans/core`
 * because the client islands next to this file import it: the core barrel pulls in BullMQ,
 * which cannot be bundled for the browser. `satisfies` keeps them honest against the real
 * unions (the same trade-off `components/admin/client/UserActions.tsx` already makes).
 */

export const ROLE_VALUES = [
  'user',
  'supporter',
  'premium',
  'uploader',
  'moderator',
  'admin',
] as const satisfies readonly Role[]

export const FEATURE_VALUES = [
  'early_access',
  'premium_content',
  'offline',
  'no_ads',
  'priority_comments',
  'see_reactors',
  'custom_gifs',
  'animated_avatar',
  'profile_banner',
] as const satisfies readonly Feature[]

export const userRoleSchema = z.enum(ROLE_VALUES)
export const userFeatureSchema = z.enum(FEATURE_VALUES)

export const BULK_ACTIONS = ['role', 'ban', 'unban', 'comment_ban', 'force_logout'] as const
export type BulkAction = (typeof BULK_ACTIONS)[number]

export const bulkUsersSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(200),
  /** Typed confirmation, exactly as the single-user role change asks for one. */
  confirm: z.string().min(1),
  action: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('role'), role: userRoleSchema }),
    z.object({ kind: z.literal('ban'), reason: z.string().trim().max(300).optional() }),
    z.object({ kind: z.literal('unban') }),
    z.object({ kind: z.literal('comment_ban'), days: z.number().int().min(1).max(365) }),
    z.object({ kind: z.literal('force_logout') }),
  ]),
})
export type BulkUsersInput = z.infer<typeof bulkUsersSchema>

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  username: z
    .string()
    .trim()
    .min(3)
    .max(24)
    .regex(/^[a-z0-9](?:[a-z0-9_]{1,22})[a-z0-9]$/i)
    .optional(),
  /** Empty means "no password": the account signs in with a reset link or OAuth. */
  password: z.string().min(10).max(200).optional(),
  role: userRoleSchema,
  verified: z.boolean(),
  entitlements: z.array(userFeatureSchema).max(FEATURE_VALUES.length),
})
export type CreateUserInput = z.infer<typeof createUserSchema>

export const BULK_CONFIRM_WORD = 'CONFIRM'
