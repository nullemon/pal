/**
 * The importer's operator configuration, stored in `settings` under the key `import`
 * (docs/17 §E). Client-safe: schemas and pure string helpers only, no database, no queue.
 */
import { z } from 'zod'

export const IMPORT_SETTING_KEY = 'import'

/** How the legacy database is reached. */
export const importSourceModes = ['dsn', 'dump', 'sample'] as const
export type ImportSourceMode = (typeof importSourceModes)[number]

/** How the legacy page images are reached. */
export const importUploadsModes = ['path', 'archive'] as const
export type ImportUploadsMode = (typeof importUploadsModes)[number]

export const importSettingSchema = z.object({
  mode: z.enum(importSourceModes).default('sample'),
  /** `mysql://user:pass@host:3306/wordpress` — the password is masked whenever it is read back. */
  dsn: z.string().max(1024).default(''),
  /** Storage key or absolute path of an uploaded mysqldump. */
  dumpPath: z.string().max(1024).default(''),
  tablePrefix: z
    .string()
    .max(32)
    .regex(/^[A-Za-z0-9_]*$/, 'Letters, digits and underscores only.')
    .default('wp_'),
  uploadsMode: z.enum(importUploadsModes).default('path'),
  /** Path the uploads directory was rsynced to (docs/09 "Images"). */
  uploadsPath: z.string().max(1024).default(''),
  /** Storage key of an uploaded uploads archive. */
  uploadsArchive: z.string().max(1024).default(''),
  batchSize: z.number().int().min(1).max(500).default(25),
  /** Import the series catalogue only, leaving page images for a later run. */
  skipImages: z.boolean().default(false),
})
export type ImportSetting = z.infer<typeof importSettingSchema>

export const defaultImportSetting = (): ImportSetting => importSettingSchema.parse({})

/** What the UI shows in place of a stored password. Sending it back means "keep it". */
export const MASKED_SECRET = '••••••••'

const DSN_RE = /^([a-z0-9+.-]+:\/\/)([^:@/]*)(?::([^@/]*))?@(.*)$/i

/**
 * Replace the password in a DSN with {@link MASKED_SECRET}. Applied every time the setting
 * is read back for display, so the credential never leaves the server.
 */
export const maskDsn = (dsn: string): string => {
  const m = DSN_RE.exec(dsn.trim())
  if (!m) return dsn.trim()
  const [, scheme = '', user = '', password, rest = ''] = m
  if (password === undefined || password === '') return `${scheme}${user}@${rest}`
  return `${scheme}${user}:${MASKED_SECRET}@${rest}`
}

/** True when the value the operator submitted still carries the mask, i.e. it was untouched. */
export const isMaskedDsn = (dsn: string): boolean => dsn.includes(MASKED_SECRET)

/**
 * Merge a submitted DSN over the stored one: if the operator did not retype the password,
 * the submitted value carries the mask and the stored password is kept.
 */
export const mergeDsn = (submitted: string, stored: string): string => {
  if (!isMaskedDsn(submitted)) return submitted.trim()
  const storedMatch = DSN_RE.exec(stored.trim())
  const password = storedMatch?.[3] ?? ''
  return submitted.trim().replace(MASKED_SECRET, password)
}

/** The setting as the admin screen may see it — every secret masked. */
export const maskImportSetting = (setting: ImportSetting): ImportSetting => ({
  ...setting,
  dsn: maskDsn(setting.dsn),
})

/** A one-line label for the report header, safe to display. */
export const describeImportSource = (setting: ImportSetting): string => {
  if (setting.mode === 'sample') return 'Built-in sample dataset'
  if (setting.mode === 'dump') return setting.dumpPath || 'SQL dump (not chosen)'
  return maskDsn(setting.dsn) || 'MySQL DSN (not set)'
}

/** Whether the source form has enough to run discovery. */
export const importSourceReady = (setting: ImportSetting): boolean => {
  if (setting.mode === 'sample') return true
  if (setting.mode === 'dump') return setting.dumpPath.trim() !== ''
  return /^[a-z0-9+.-]+:\/\/.+@.+/i.test(setting.dsn.trim())
}
