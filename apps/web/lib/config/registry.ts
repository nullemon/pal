/**
 * Every value the operator can set from Admin → System → Integrations (docs/19).
 *
 * This file is the single declaration: the admin screen renders from it, the store validates
 * against it, and the resolvers read through it. Client-safe — metadata only, no database.
 *
 * What is deliberately *not* here: `DATABASE_URL`, `SESSION_SECRET`, `SITE_URL`,
 * `TRUSTED_PROXY`, `REDIS_URL`. Those are needed before there is a database to read them
 * from or a session to authenticate the panel with, so they stay in the environment. Every
 * other credential can be typed into the panel and takes effect without a redeploy.
 */

export const CONFIG_GROUPS = [
  'storage',
  'email',
  'oauth',
  'payments',
  'bot',
  'push',
  'discord',
] as const
export type ConfigGroup = (typeof CONFIG_GROUPS)[number]

export type FieldKind = 'text' | 'password' | 'url' | 'number' | 'boolean' | 'select'

export interface ConfigField {
  id: string
  group: ConfigGroup
  label: string
  hint?: string
  /** Secrets are never echoed back to the browser — the panel only reports "set". */
  secret: boolean
  /** The environment variable this falls back to when nothing is stored. */
  env: string
  kind: FieldKind
  options?: readonly { value: string; label: string }[]
  placeholder?: string
  /** Shown only when another field has one of these values (e.g. S3 fields under driver=s3). */
  showWhen?: { field: string; equals: readonly string[] }
}

export const CONFIG_FIELDS: readonly ConfigField[] = [
  // --- storage -------------------------------------------------------------
  {
    id: 'storage.driver',
    group: 'storage',
    label: 'Driver',
    hint: 'Cloudflare R2 (or any S3-compatible bucket) in production. Local folder is for development only.',
    secret: false,
    env: 'STORAGE_DRIVER',
    kind: 'select',
    options: [
      { value: 's3', label: 'S3 / Cloudflare R2' },
      { value: 'fs', label: 'Local folder' },
    ],
  },
  {
    id: 'storage.public_cdn_url',
    group: 'storage',
    label: 'Public image URL',
    hint: 'The hostname readers load covers and pages from — the custom domain on your image bucket, e.g. https://palimages.org. Never your own server: reader traffic is the largest thing this site does and this is what keeps it off your box.',
    secret: false,
    env: 'PUBLIC_CDN_URL',
    kind: 'url',
    placeholder: 'https://palimages.org',
  },
  {
    id: 's3.endpoint',
    group: 'storage',
    label: 'Endpoint',
    hint: 'R2 gives you this on the bucket page.',
    secret: false,
    env: 'S3_ENDPOINT',
    kind: 'url',
    placeholder: 'https://<account>.r2.cloudflarestorage.com',
    showWhen: { field: 'storage.driver', equals: ['s3'] },
  },
  {
    id: 's3.bucket',
    group: 'storage',
    label: 'Image bucket',
    hint: 'The bucket the public image URL above is a custom domain on. Holds only what a reader fetches: pages, covers, banners and avatars.',
    secret: false,
    env: 'S3_BUCKET',
    kind: 'text',
    placeholder: 'palscans',
    showWhen: { field: 'storage.driver', equals: ['s3'] },
  },
  {
    id: 's3.access_key_id',
    group: 'storage',
    label: 'Access key ID',
    secret: false,
    env: 'S3_ACCESS_KEY_ID',
    kind: 'text',
    showWhen: { field: 'storage.driver', equals: ['s3'] },
  },
  {
    id: 's3.secret_access_key',
    group: 'storage',
    label: 'Secret access key',
    secret: true,
    env: 'S3_SECRET_ACCESS_KEY',
    kind: 'password',
    showWhen: { field: 'storage.driver', equals: ['s3'] },
  },
  {
    id: 's3.region',
    group: 'storage',
    label: 'Region',
    hint: 'R2 uses "auto".',
    secret: false,
    env: 'S3_REGION',
    kind: 'text',
    placeholder: 'auto',
    showWhen: { field: 'storage.driver', equals: ['s3'] },
  },
  {
    id: 's3.force_path_style',
    group: 'storage',
    label: 'Force path-style URLs',
    hint: 'Needed by MinIO and some S3 clones. Leave off for R2.',
    secret: false,
    env: 'S3_FORCE_PATH_STYLE',
    kind: 'boolean',
    showWhen: { field: 'storage.driver', equals: ['s3'] },
  },

  // --- the private vault ---------------------------------------------------
  // Endpoint and credentials are optional throughout: blank means "same account as the
  // image bucket", which is the common case and reduces this section to one field.
  {
    id: 'vault.bucket',
    group: 'storage',
    label: 'Vault bucket',
    hint: 'A second bucket with NO custom domain, holding the raw files you upload. Leave empty to keep them in the image bucket, where only a Cloudflare rule hides them.',
    secret: false,
    env: 'VAULT_S3_BUCKET',
    kind: 'text',
    placeholder: 'palscans-vault',
    showWhen: { field: 'storage.driver', equals: ['s3'] },
  },
  {
    id: 'vault.endpoint',
    group: 'storage',
    label: 'Vault endpoint',
    hint: 'Only if the vault lives in a different account. Empty reuses the endpoint above.',
    secret: false,
    env: 'VAULT_S3_ENDPOINT',
    kind: 'url',
    showWhen: { field: 'storage.driver', equals: ['s3'] },
  },
  {
    id: 'vault.access_key_id',
    group: 'storage',
    label: 'Vault access key ID',
    hint: 'Empty reuses the key above.',
    secret: false,
    env: 'VAULT_S3_ACCESS_KEY_ID',
    kind: 'text',
    showWhen: { field: 'storage.driver', equals: ['s3'] },
  },
  {
    id: 'vault.secret_access_key',
    group: 'storage',
    label: 'Vault secret access key',
    secret: true,
    env: 'VAULT_S3_SECRET_ACCESS_KEY',
    kind: 'password',
    showWhen: { field: 'storage.driver', equals: ['s3'] },
  },

  // --- the object mirror ---------------------------------------------------
  {
    id: 'objects_backup.bucket',
    group: 'storage',
    label: 'Image backup bucket',
    hint: 'Every durable object is copied here, so a corrupted or deleted image has somewhere to come back from. R2 has no object versioning — without this there is no undelete. Distinct from the database backup bucket on the Backup screen.',
    secret: false,
    env: 'OBJECT_BACKUP_S3_BUCKET',
    kind: 'text',
    placeholder: 'palscans-image-backup',
    showWhen: { field: 'storage.driver', equals: ['s3'] },
  },
  {
    id: 'objects_backup.endpoint',
    group: 'storage',
    label: 'Image backup endpoint',
    hint: 'Only if the mirror lives in a different account — which is the point of a mirror. Empty reuses the endpoint above.',
    secret: false,
    env: 'OBJECT_BACKUP_S3_ENDPOINT',
    kind: 'url',
    showWhen: { field: 'storage.driver', equals: ['s3'] },
  },
  {
    id: 'objects_backup.access_key_id',
    group: 'storage',
    label: 'Image backup access key ID',
    hint: 'Empty reuses the key above.',
    secret: false,
    env: 'OBJECT_BACKUP_S3_ACCESS_KEY_ID',
    kind: 'text',
    showWhen: { field: 'storage.driver', equals: ['s3'] },
  },
  {
    id: 'objects_backup.secret_access_key',
    group: 'storage',
    label: 'Image backup secret access key',
    secret: true,
    env: 'OBJECT_BACKUP_S3_SECRET_ACCESS_KEY',
    kind: 'password',
    showWhen: { field: 'storage.driver', equals: ['s3'] },
  },

  // --- email ---------------------------------------------------------------
  {
    id: 'email.from',
    group: 'email',
    label: 'From address',
    hint: 'Verification and password-reset mail is sent from here.',
    secret: false,
    env: 'EMAIL_FROM',
    kind: 'text',
    placeholder: 'PALScans <no-reply@palscans.org>',
  },
  {
    id: 'email.resend_api_key',
    group: 'email',
    label: 'Resend API key',
    hint: 'Set this to send through Resend. Leave empty to use SMTP below.',
    secret: true,
    env: 'RESEND_API_KEY',
    kind: 'password',
    placeholder: 're_...',
  },
  {
    id: 'email.smtp_host',
    group: 'email',
    label: 'SMTP host',
    secret: false,
    env: 'SMTP_HOST',
    kind: 'text',
  },
  {
    id: 'email.smtp_port',
    group: 'email',
    label: 'SMTP port',
    secret: false,
    env: 'SMTP_PORT',
    kind: 'number',
    placeholder: '587',
  },
  {
    id: 'email.smtp_user',
    group: 'email',
    label: 'SMTP username',
    secret: false,
    env: 'SMTP_USER',
    kind: 'text',
  },
  {
    id: 'email.smtp_password',
    group: 'email',
    label: 'SMTP password',
    secret: true,
    env: 'SMTP_PASSWORD',
    kind: 'password',
  },

  // --- oauth ---------------------------------------------------------------
  {
    id: 'oauth.google_client_id',
    group: 'oauth',
    label: 'Google client ID',
    secret: false,
    env: 'GOOGLE_CLIENT_ID',
    kind: 'text',
  },
  {
    id: 'oauth.google_client_secret',
    group: 'oauth',
    label: 'Google client secret',
    secret: true,
    env: 'GOOGLE_CLIENT_SECRET',
    kind: 'password',
  },
  {
    id: 'oauth.discord_client_id',
    group: 'oauth',
    label: 'Discord client ID',
    secret: false,
    env: 'DISCORD_CLIENT_ID',
    kind: 'text',
  },
  {
    id: 'oauth.discord_client_secret',
    group: 'oauth',
    label: 'Discord client secret',
    secret: true,
    env: 'DISCORD_CLIENT_SECRET',
    kind: 'password',
  },

  // --- payments ------------------------------------------------------------
  {
    id: 'payments.stripe_secret_key',
    group: 'payments',
    label: 'Stripe secret key',
    hint: 'Without this the Premium screens stay visible but inert.',
    secret: true,
    env: 'STRIPE_SECRET_KEY',
    kind: 'password',
    placeholder: 'sk_live_...',
  },
  {
    id: 'payments.stripe_webhook_secret',
    group: 'payments',
    label: 'Stripe webhook signing secret',
    hint: 'From the webhook endpoint you point at /api/webhooks/stripe.',
    secret: true,
    env: 'STRIPE_WEBHOOK_SECRET',
    kind: 'password',
    placeholder: 'whsec_...',
  },

  // --- bot protection ------------------------------------------------------
  {
    id: 'bot.turnstile_site_key',
    group: 'bot',
    label: 'Turnstile site key',
    hint: 'Public — it is rendered into the page.',
    secret: false,
    env: 'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
    kind: 'text',
  },
  {
    id: 'bot.turnstile_secret_key',
    group: 'bot',
    label: 'Turnstile secret key',
    secret: true,
    env: 'TURNSTILE_SECRET_KEY',
    kind: 'password',
  },

  // --- push ----------------------------------------------------------------
  {
    id: 'push.vapid_public_key',
    group: 'push',
    label: 'VAPID public key',
    hint: 'Generate a pair with `npx web-push generate-vapid-keys`.',
    secret: false,
    env: 'VAPID_PUBLIC_KEY',
    kind: 'text',
  },
  {
    id: 'push.vapid_private_key',
    group: 'push',
    label: 'VAPID private key',
    secret: true,
    env: 'VAPID_PRIVATE_KEY',
    kind: 'password',
  },
  {
    id: 'push.vapid_subject',
    group: 'push',
    label: 'VAPID subject',
    hint: 'A mailto: or https: URL identifying you to the push service.',
    secret: false,
    env: 'VAPID_SUBJECT',
    kind: 'text',
    placeholder: 'mailto:ops@palscans.org',
  },

  // --- discord -------------------------------------------------------------
  {
    id: 'discord.bot_token',
    group: 'discord',
    label: 'Bot token',
    secret: true,
    env: 'DISCORD_BOT_TOKEN',
    kind: 'password',
  },
  {
    id: 'discord.guild_id',
    group: 'discord',
    label: 'Server (guild) ID',
    secret: false,
    env: 'DISCORD_GUILD_ID',
    kind: 'text',
  },
]

export const FIELDS_BY_ID: ReadonlyMap<string, ConfigField> = new Map(
  CONFIG_FIELDS.map((f) => [f.id, f]),
)

export const fieldsIn = (group: ConfigGroup): readonly ConfigField[] =>
  CONFIG_FIELDS.filter((f) => f.group === group)

/** What the panel shows for a secret that is set. Sending it back unchanged means "keep it". */
export const SECRET_MASK = '••••••••'

export const isMasked = (value: string): boolean => value.includes(SECRET_MASK)
