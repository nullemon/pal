/**
 * What the dump adapter is handed instead of reaching for the filesystem itself: a reader
 * that can open the dump for a forward pass, and a reader that can fetch one page image out
 * of the uploads tree. Both are injected, so the parser and the whole {@link LegacySource}
 * implementation are testable from a string with no disk involved.
 *
 * Nothing in this file imports `node:*`; the concrete file-backed readers live in `fs.ts`.
 */

/**
 * A re-openable, forward-only view of the dump.
 *
 * `open()` is called once per pass and must return a *fresh* stream every time: the adapter
 * makes one indexing pass and then one streaming pass per `listSeries()` / `listBookmarks()`
 * / `listUsers()` / `listComments()` call, rather than buffering `wp_posts` in memory.
 */
export interface DumpReader {
  /** Shown in the report header and in errors: a file name, not a path with credentials. */
  readonly name: string
  open(): AsyncIterable<Uint8Array | string>
}

/** Resolves a stored page path against the uploads tree rsynced next to the dump (docs/09). */
export interface UploadsReader {
  readonly name: string
  /** Throws {@link LegacyPageUnavailableError} with reason `not-found` when absent. */
  read(path: string): Promise<Uint8Array>
}

export type LegacyPageUnavailableReason =
  /** No uploads path or archive is configured — a broken configuration, not empty data. */
  | 'uploads-not-configured'
  /** The theme stored this chapter on imgur/Google/S3; the bytes are not in the uploads tree. */
  | 'remote-storage'
  /** Configured, but the file is not there. */
  | 'not-found'

/**
 * Why a page's bytes could not be produced. A SQL dump never contains image data, so the
 * caller has to be able to tell "the operator asked for a catalogue-only import"
 * (`config.skipImages`) from "the uploads tree is missing or misconfigured" — hence a typed
 * error rather than an empty {@link LegacyPageImage}.
 */
export class LegacyPageUnavailableError extends Error {
  readonly reason: LegacyPageUnavailableReason
  readonly path: string
  constructor(reason: LegacyPageUnavailableReason, path: string, detail?: string) {
    super(
      detail ??
        {
          'uploads-not-configured': `No uploads source is configured, so the bytes of "${path}" cannot be read. Set the uploads path (or enable "catalogue only" to skip images).`,
          'remote-storage': `"${path}" is stored on a remote host by the legacy theme, not in the uploads tree; it has to be fetched separately.`,
          'not-found': `"${path}" is not in the uploads tree.`,
        }[reason],
    )
    this.name = 'LegacyPageUnavailableError'
    this.reason = reason
    this.path = path
  }
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
}

/** Content type from the stored file name; the pipeline sniffs the bytes anyway. */
export const contentTypeForPath = (path: string): string | undefined => {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return undefined
  return CONTENT_TYPES[path.slice(dot + 1).toLowerCase()]
}

/** True for a page whose stored path is an absolute URL (cloud storage, not the uploads tree). */
export const isRemotePath = (path: string): boolean => /^[a-z][a-z0-9+.-]*:\/\//i.test(path)

/** Join a stored `src` onto the theme's data prefix, tolerating slashes on either side. */
export const joinStoredPath = (prefix: string, src: string): string => {
  const tail = src.replace(/^\/+/, '')
  const head = prefix.replace(/\/+$/, '')
  return head === '' ? tail : `${head}/${tail}`
}

const textEncoder = new TextEncoder()

export interface StringReaderOptions {
  name?: string
  /** Bytes (or characters) per chunk. Small values exercise the streaming paths. */
  chunkSize?: number
}

/** A {@link DumpReader} over a string in memory — the shape the unit tests feed. */
export const stringDumpReader = (sql: string, options: StringReaderOptions = {}): DumpReader => {
  const size = Math.max(1, options.chunkSize ?? 64 * 1024)
  return {
    name: options.name ?? 'in-memory dump',
    async *open(): AsyncIterable<string> {
      for (let at = 0; at < sql.length; at += size) yield sql.slice(at, at + size)
    },
  }
}

/** A {@link DumpReader} over bytes in memory, so UTF-8 boundary handling can be exercised. */
export const bytesDumpReader = (
  bytes: Uint8Array | string,
  options: StringReaderOptions = {},
): DumpReader => {
  const data = typeof bytes === 'string' ? textEncoder.encode(bytes) : bytes
  const size = Math.max(1, options.chunkSize ?? 64 * 1024)
  return {
    name: options.name ?? 'in-memory dump',
    async *open(): AsyncIterable<Uint8Array> {
      for (let at = 0; at < data.length; at += size) yield data.subarray(at, at + size)
    },
  }
}

/** An {@link UploadsReader} over a plain map of path → bytes, for tests and dry runs. */
export const memoryUploadsReader = (
  files: Readonly<Record<string, Uint8Array | string>>,
  name = 'in-memory uploads',
): UploadsReader => ({
  name,
  read: async (path: string): Promise<Uint8Array> => {
    const found = files[path]
    if (found === undefined) throw new LegacyPageUnavailableError('not-found', path)
    return typeof found === 'string' ? textEncoder.encode(found) : found
  },
})
