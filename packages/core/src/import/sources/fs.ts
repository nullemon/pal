/**
 * The file-backed halves of the dump adapter: a {@link DumpReader} over a `.sql` (or
 * `.sql.gz`) file and an {@link UploadsReader} over the uploads tree docs/09 has the
 * operator rsync next to it.
 *
 * This is the only file in `import/sources` that touches `node:*`, which is why the whole
 * folder sits behind its own `@palscans/core/import/sources` subpath: `@palscans/core/import`
 * itself stays pure — no database, no queue, no filesystem.
 */
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createGunzip } from 'node:zlib'
import type { ImportSetting } from '../config.js'
import { createDumpSource, type DumpSourceOptions, type MysqlDumpSource } from './dump.js'
import { type DumpReader, LegacyPageUnavailableError, type UploadsReader } from './types.js'

export interface FileDumpReaderOptions {
  /** Label for the report; defaults to the file's base name. */
  name?: string
  /** Force gzip decoding on/off. Default: on for `.gz` / `.gzip`. */
  gunzip?: boolean
  /** Bytes per read. Larger is fewer syscalls; the parser does not care. */
  highWaterMark?: number
}

/** Stream a mysqldump off disk, one fresh read per pass. */
export const fileDumpReader = (
  filePath: string,
  options: FileDumpReaderOptions = {},
): DumpReader => {
  const compressed = options.gunzip ?? /\.(gz|gzip)$/i.test(filePath)
  return {
    name: options.name ?? path.basename(filePath),
    open(): AsyncIterable<Uint8Array> {
      const file = createReadStream(filePath, { highWaterMark: options.highWaterMark ?? 1 << 20 })
      if (!compressed) return file as unknown as AsyncIterable<Uint8Array>
      const gunzip = createGunzip()
      // `pipe` does not forward errors; without this a missing file would hang the pass.
      file.on('error', (err) => gunzip.destroy(err))
      file.pipe(gunzip)
      return gunzip as unknown as AsyncIterable<Uint8Array>
    },
  }
}

export interface DirectoryUploadsReaderOptions {
  name?: string
}

/**
 * Read page images out of the rsynced uploads directory. Stored paths are resolved against
 * the root and refused if they escape it — the dump is operator-supplied data, not code.
 */
export const directoryUploadsReader = (
  root: string,
  options: DirectoryUploadsReaderOptions = {},
): UploadsReader => {
  const base = path.resolve(root)
  return {
    name: options.name ?? base,
    read: async (stored: string): Promise<Uint8Array> => {
      const target = path.resolve(base, stored)
      if (target !== base && !target.startsWith(`${base}${path.sep}`))
        throw new LegacyPageUnavailableError(
          'not-found',
          stored,
          `"${stored}" resolves outside the uploads root and was not read.`,
        )
      try {
        return await readFile(target)
      } catch {
        throw new LegacyPageUnavailableError('not-found', stored)
      }
    },
  }
}

export type DumpSourceFromSettingOptions = Omit<DumpSourceOptions, 'reader' | 'tablePrefix'>

/**
 * Build the adapter straight from the operator's stored import settings.
 *
 * `uploadsMode: 'archive'` is not wired here: nothing in this package can open a zip or tar
 * without a new dependency, so the archive has to be extracted and its path given as
 * `uploadsPath`. Until it is, `readPage()` throws `uploads-not-configured` rather than
 * pretending the bytes were empty.
 */
export const createDumpSourceFromSetting = (
  setting: ImportSetting,
  overrides: DumpSourceFromSettingOptions = {},
): MysqlDumpSource => {
  const dumpPath = setting.dumpPath.trim()
  if (dumpPath === '') throw new Error('No SQL dump has been chosen in the import settings.')
  const uploadsPath = setting.uploadsPath.trim()
  const uploads =
    overrides.uploads !== undefined
      ? overrides.uploads
      : setting.uploadsMode === 'path' && uploadsPath !== '' && !setting.skipImages
        ? directoryUploadsReader(uploadsPath)
        : null
  return createDumpSource({
    ...overrides,
    reader:
      overrides.name === undefined
        ? fileDumpReader(dumpPath)
        : fileDumpReader(dumpPath, { name: overrides.name }),
    tablePrefix: setting.tablePrefix,
    uploads,
    indexPages: overrides.indexPages ?? !setting.skipImages,
  })
}
