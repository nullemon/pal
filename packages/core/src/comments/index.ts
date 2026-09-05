/**
 * The comment model, as the *browser* may have it: node types, the structural caps, and the
 * pure walkers (`plainText`, `mentions`, `hasSpoiler`, …) the composer and the renderer use.
 *
 * `./schema.js` is deliberately absent. It holds the zod parsers for untrusted bodies, which
 * only ever run on the server, and re-exporting them here would put zod — 83 KB gzipped —
 * into every reader's bundle by way of this barrel. Import `@palscans/core/comments/schema`
 * where you need them. See docs/20 "Front-end budgets".
 */
export * from './automod.js'
export * from './body.js'
export * from './links.js'
export * from './render.js'
