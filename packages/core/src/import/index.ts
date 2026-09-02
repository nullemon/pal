/**
 * The legacy WordPress importer's portable core (docs/09, docs/17 §E). Framework-free:
 * an adapter interface, the docs/09 mapping as pure functions, redirect generation, and the
 * two read-only reports the admin screen shows. No database, no queue, no filesystem.
 */
export * from './chapter-number.js'
export * from './comment-html.js'
export * from './config.js'
export * from './discover.js'
export * from './dry-run.js'
export * from './map.js'
export * from './php-serialize.js'
export * from './redirects.js'
export * from './source.js'
