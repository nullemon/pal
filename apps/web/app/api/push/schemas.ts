import { z } from 'zod'

/** Every input `/api/push/*` accepts (docs/16: zod on every route). */

/** What `PushSubscription.toJSON()` produces, narrowed to the three fields we store. */
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
})

export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url().max(1000),
})

export const discordRedeemSchema = z.object({
  code: z.string().trim().min(4).max(16),
  /** Discord snowflake. */
  discordId: z
    .string()
    .trim()
    .regex(/^\d{5,25}$/, 'must be a Discord user id'),
  discordUsername: z.string().trim().max(64).optional(),
})
