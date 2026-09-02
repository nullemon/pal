import {
  defaultImportSetting,
  IMPORT_SETTING_KEY,
  type ImportSetting,
  importSettingSchema,
  type LegacySource,
} from '@palscans/core/import'
import { createFixtureSource } from '@palscans/core/import/fixtures'
import { createDumpSourceFromSetting } from '@palscans/core/import/sources'
import { type Db, getSetting } from '@palscans/db'
import { z } from 'zod'

/**
 * Open the legacy source the operator configured. The stored document is the same one the
 * admin screen writes, so the worker and the dry run always agree about what is being read.
 */

const docSchema = z.object({ config: importSettingSchema.optional() })

export const readImportConfig = async (db: Db): Promise<ImportSetting> => {
  const raw = await getSetting<unknown>(db, IMPORT_SETTING_KEY, {})
  const parsed = docSchema.safeParse(raw)
  return parsed.success ? (parsed.data.config ?? defaultImportSetting()) : defaultImportSetting()
}

/** Raised when the configured connector has no implementation, so the run fails loudly. */
export class UnavailableConnectorError extends Error {
  constructor(readonly mode: ImportSetting['mode']) {
    super(`The ${mode} connector is not available in this build.`)
    this.name = 'UnavailableConnectorError'
  }
}

export const openSource = async (config: ImportSetting): Promise<LegacySource> => {
  if (config.mode === 'sample') return createFixtureSource()
  if (config.mode === 'dump') return createDumpSourceFromSetting(config)
  // A live MySQL connection needs a driver this build does not carry; export a dump instead.
  throw new UnavailableConnectorError(config.mode)
}
