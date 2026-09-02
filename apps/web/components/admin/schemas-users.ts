import { FEATURES } from '@palscans/core'
import { z } from 'zod'

export const roleSchema = z.enum(['user', 'supporter', 'premium', 'uploader', 'moderator', 'admin'])
/** Every operator-controlled feature can also be granted to one account (docs/17 §B). */
export const featureSchema = z.enum(FEATURES)

export const userActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('role'), role: roleSchema, confirm: z.string().min(1) }),
  z.object({
    action: z.literal('grant'),
    feature: featureSchema,
    expiresAt: z.string().datetime({ offset: true }).nullable(),
  }),
  z.object({ action: z.literal('revoke'), feature: featureSchema }),
  z.object({ action: z.literal('revoke_session'), sessionId: z.string().uuid() }),
  z.object({ action: z.literal('force_logout') }),
  z.object({
    action: z.literal('comment_ban'),
    until: z.string().datetime({ offset: true }).nullable(),
  }),
  z.object({
    action: z.literal('ban'),
    reason: z.string().trim().max(300).optional(),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  }),
  z.object({ action: z.literal('unban') }),
  z.object({ action: z.literal('resend_verification') }),
])
export type UserAction = z.infer<typeof userActionSchema>
