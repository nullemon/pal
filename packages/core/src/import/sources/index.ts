/**
 * Concrete {@link LegacySource} connectors for the importer (docs/17 §E), behind their own
 * subpath because they do I/O: `@palscans/core/import` itself stays pure, exactly as
 * `@palscans/core/storage/s3` and `@palscans/core/queue/bullmq` sit beside their pure
 * `storage` / `queue` entry points.
 *
 * Today: the mysqldump connector. The live MySQL DSN connector lands beside it.
 */
export * from './dump.js'
export * from './fs.js'
export * from './sql-stream.js'
export * from './types.js'
