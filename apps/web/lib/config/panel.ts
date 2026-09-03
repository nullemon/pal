import { z } from 'zod'
import {
  CONFIG_GROUPS,
  type ConfigField,
  type ConfigGroup,
  FIELDS_BY_ID,
  fieldsIn,
  isMasked,
} from './registry'

/**
 * The rules Admin → System → Integrations is built from: what a submitted payload may
 * contain, which fields are currently visible, and whether a group has enough to work
 * (docs/19).
 *
 * Client-safe on purpose — the screen and the route handler must agree about all three, and
 * the only way to guarantee that is to have them read the same module. Nothing here touches
 * the database, the environment, or a secret value.
 */

/** Enough for a PEM-ish key or a long endpoint; far short of the 64 KB body cap. */
const MAX_VALUE_CHARS = 4096

const isBlank = (value: string | undefined): boolean => (value ?? '').trim() === ''

/** A field is shown only when its `showWhen` dependency currently holds one of its values. */
export const fieldVisible = (field: ConfigField, values: Record<string, string>): boolean =>
  !field.showWhen || field.showWhen.equals.includes((values[field.showWhen.field] ?? '').trim())

export const visibleFieldsIn = (
  group: ConfigGroup,
  values: Record<string, string>,
): readonly ConfigField[] => fieldsIn(group).filter((f) => fieldVisible(f, values))

/* ------------------------------------------------------------------ validation */

/**
 * One value, checked against what its `kind` promises. Secrets are exempt from format rules:
 * the browser sends the mask back for a stored secret it never saw, and that has to survive.
 */
const checkValue = (field: ConfigField, raw: string): string | null => {
  const value = raw.trim()
  if (value === '') return null
  if (field.secret && isMasked(value)) return null
  switch (field.kind) {
    case 'select':
      return field.options?.some((o) => o.value === value) ? null : 'not one of the options'
    case 'boolean':
      return value === 'true' || value === 'false' ? null : 'must be true or false'
    case 'number': {
      const n = Number(value)
      return Number.isInteger(n) && n >= 0 && n <= 65535 ? null : 'must be a whole number'
    }
    case 'url': {
      try {
        const url = new URL(value)
        return url.protocol === 'http:' || url.protocol === 'https:'
          ? null
          : 'must be an http(s) URL'
      } catch {
        return 'must be a URL'
      }
    }
    default:
      return null
  }
}

/**
 * `{ id: value }` where every id is in the registry. An unknown id is rejected rather than
 * quietly dropped: a typo in a key would otherwise look like a successful save that did
 * nothing.
 */
const valuesSchema = z
  .record(z.string(), z.string().max(MAX_VALUE_CHARS))
  .superRefine((record, ctx) => {
    for (const [id, value] of Object.entries(record)) {
      const field = FIELDS_BY_ID.get(id)
      if (!field) {
        ctx.addIssue({ code: 'custom', path: [id], message: `unknown setting "${id}"` })
        continue
      }
      const problem = checkValue(field, value)
      if (problem) ctx.addIssue({ code: 'custom', path: [id], message: problem })
    }
  })

export const integrationsPutSchema = z.object({ values: valuesSchema })
export type IntegrationsPut = z.infer<typeof integrationsPutSchema>

export const integrationsTestSchema = z.object({
  group: z.enum(CONFIG_GROUPS),
  /** The form's current values, so a credential can be proved before it is stored. */
  values: valuesSchema,
})
export type IntegrationsTest = z.infer<typeof integrationsTestSchema>

/* --------------------------------------------------------------------- status */

export type GroupState = 'ready' | 'partial' | 'off'

export interface GroupStatus {
  state: GroupState
  /** Field ids that would have to be filled in for this group to work. */
  missing: readonly string[]
}

/**
 * What a group needs before it does anything. `all` must be complete; `anyOf` is satisfied by
 * any one complete alternative (either OAuth provider on its own is a working sign-in
 * button, and Resend and SMTP are two ways to send the same mail).
 */
interface GroupRule {
  all?: readonly string[]
  anyOf?: readonly (readonly string[])[]
}

const RULES: Record<ConfigGroup, GroupRule> = {
  storage: { all: ['storage.driver'] },
  email: {
    all: ['email.from'],
    anyOf: [['email.resend_api_key'], ['email.smtp_host', 'email.smtp_port', 'email.smtp_user']],
  },
  oauth: {
    anyOf: [
      ['oauth.google_client_id', 'oauth.google_client_secret'],
      ['oauth.discord_client_id', 'oauth.discord_client_secret'],
    ],
  },
  payments: { all: ['payments.stripe_secret_key', 'payments.stripe_webhook_secret'] },
  bot: { all: ['bot.turnstile_site_key', 'bot.turnstile_secret_key'] },
  push: { all: ['push.vapid_public_key', 'push.vapid_private_key', 'push.vapid_subject'] },
  discord: { all: ['discord.bot_token', 'discord.guild_id'] },
}

/** S3 needs its own credentials; the local-folder driver needs nothing at all. */
const storageRule = (values: Record<string, string>): GroupRule =>
  (values['storage.driver'] ?? '').trim() === 's3'
    ? {
        all: [
          'storage.driver',
          'storage.public_cdn_url',
          's3.endpoint',
          's3.bucket',
          's3.access_key_id',
          's3.secret_access_key',
        ],
      }
    : RULES.storage

/**
 * Configured, half configured, or untouched — the one thing the operator wants to see before
 * launch. A secret counts as set when the panel shows its mask, which is all the browser
 * ever gets.
 */
export const groupStatus = (group: ConfigGroup, values: Record<string, string>): GroupStatus => {
  const rule = group === 'storage' ? storageRule(values) : RULES[group]
  const missingFrom = (ids: readonly string[]) => ids.filter((id) => isBlank(values[id]))

  const missingAll = missingFrom(rule.all ?? [])
  const alternatives = (rule.anyOf ?? []).map((ids) => ({ ids, missing: missingFrom(ids) }))
  const bestAlternative = alternatives.length
    ? alternatives.reduce((a, b) => (a.missing.length <= b.missing.length ? a : b))
    : null
  const missing = [...missingAll, ...(bestAlternative?.missing ?? [])]
  if (missing.length === 0) return { state: 'ready', missing }

  const touched = fieldsIn(group).some(
    (f) => fieldVisible(f, values) && !isBlank(values[f.id]) && f.kind !== 'boolean',
  )
  return { state: touched ? 'partial' : 'off', missing }
}
