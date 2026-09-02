import 'server-only'
import {
  type DiscoveryReport,
  type DryRunReport,
  defaultImportSetting,
  type ImportSetting,
  importSettingSchema,
  type LegacySource,
  maskImportSetting,
  type UnparsedChapter,
} from '@palscans/core/import'
import { createFixtureSource } from '@palscans/core/import/fixtures'
import { createDumpSourceFromSetting } from '@palscans/core/import/sources'
import { getDb, getSetting, settings } from '@palscans/db'
import { z } from 'zod'
import type { ImportDoc, StoredDryRun } from './types'

/**
 * Server side of Admin → System → Import (docs/17 §E). The stored document is the operator's
 * source configuration plus the last discovery and dry-run reports, so the screen reloads
 * into the state the operator left it in. Everything else lives in @palscans/core/import.
 */
export const IMPORT_KEY = 'import'

/** The dry-run report as stored: the unparsed list is capped, the CSV route re-runs for the rest. */
export const STORED_UNPARSED_LIMIT = 200

const docSchema = z.object({
  config: importSettingSchema.optional(),
  discovery: z.unknown().optional(),
  dryRun: z.unknown().optional(),
})

const emptyDoc = (): ImportDoc => ({
  config: defaultImportSetting(),
  discovery: null,
  dryRun: null,
})

/** Read the stored document. Secrets are returned intact — mask before sending it anywhere. */
export const readImportDoc = async (): Promise<ImportDoc> => {
  const db = await getDb()
  const raw = await getSetting<unknown>(db, IMPORT_KEY, {})
  const parsed = docSchema.safeParse(raw)
  if (!parsed.success) return emptyDoc()
  return {
    config: parsed.data.config ?? defaultImportSetting(),
    discovery: (parsed.data.discovery as ImportDoc['discovery']) ?? null,
    dryRun: (parsed.data.dryRun as ImportDoc['dryRun']) ?? null,
  }
}

/** The document as the browser may see it: the DSN password replaced by the mask. */
export const maskImportDoc = (doc: ImportDoc): ImportDoc => ({
  ...doc,
  config: maskImportSetting(doc.config),
})

export const writeImportDoc = async (doc: ImportDoc, userId: number): Promise<void> => {
  const db = await getDb()
  const now = new Date()
  await db
    .insert(settings)
    .values({ key: IMPORT_KEY, value: doc, updatedBy: userId, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: doc, updatedBy: userId, updatedAt: now },
    })
}

/** Raised when the operator picked a connection the importer cannot open yet. */
export class ConnectorUnavailableError extends Error {
  readonly mode: ImportSetting['mode']
  constructor(mode: ImportSetting['mode']) {
    super(`The ${mode} connector is not built yet.`)
    this.name = 'ConnectorUnavailableError'
    this.mode = mode
  }
}

/**
 * Resolve a {@link LegacySource} for the stored configuration.
 *
 * The sample dataset and a mysqldump file are both real connectors. A live MySQL DSN needs a
 * driver this build does not carry, so it falls back to the sample source and `fallback`
 * tells the screen to say so rather than passing off sample numbers as the operator's own.
 */
export const resolveSource = (
  config: ImportSetting,
): { source: LegacySource; fallback: ImportSetting['mode'] | null } => {
  if (config.mode === 'sample') return { source: createFixtureSource(), fallback: null }
  if (config.mode === 'dump') return { source: createDumpSourceFromSetting(config), fallback: null }
  return {
    source: createFixtureSource({ name: 'Built-in sample dataset (stand-in)' }),
    fallback: config.mode,
  }
}

/** Trim a dry-run report to what the settings row should carry. */
export const storeableDryRun = (report: DryRunReport, ranAt: string): StoredDryRun => ({
  ...report,
  unparsedChapters: report.unparsedChapters.slice(0, STORED_UNPARSED_LIMIT),
  warnings: report.warnings.slice(0, 100),
  ranAt,
})

export type { ImportDoc, StoredDiscovery, StoredDryRun } from './types'
export type { DiscoveryReport, DryRunReport, ImportSetting, UnparsedChapter }
