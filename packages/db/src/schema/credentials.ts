import { boolean, pgTable, text } from 'drizzle-orm/pg-core'
import { ref, timestamptz } from './_shared.js'
import { bytea } from './custom-types.js'
import { users } from './identity.js'

/**
 * Integration credentials the operator enters in the admin panel rather than in `.env`
 * (docs/19). `sealed` is AES-256-GCM ciphertext — nothing here is readable without the
 * process's sealing key, so this table can safely appear in a database backup.
 *
 * Only credentials live here. Bootstrap values (`DATABASE_URL`, `SESSION_SECRET`,
 * `SITE_URL`, `TRUSTED_PROXY`) cannot: they are needed before there is a database to read
 * or a session to authenticate the panel with.
 */
export const appCredentials = pgTable('app_credentials', {
  /** Registry id, e.g. `s3.secret_access_key`. */
  key: text('key').primaryKey(),
  sealed: bytea('sealed').notNull(),
  /** The panel reports a secret as set or unset; it never echoes the value back. */
  isSecret: boolean('is_secret').notNull().default(true),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  updatedBy: ref('updated_by').references(() => users.id, { onDelete: 'set null' }),
})
