/**
 * Which bucket an object key belongs in (docs/08 "Object storage").
 *
 * The site stores three kinds of thing and they have three different risk profiles, so they
 * get three buckets:
 *
 * - **public** — what a reader's browser fetches by URL: page images, covers, banners and
 *   avatars. This is the PALImages bucket, and the only one with a hostname attached.
 * - **private** — the raw originals exactly as they came off the uploader's disk, the built
 *   sitemap files and the storage healthcheck probe. No public hostname, ever: reaching one
 *   of these needs a presigned URL the app mints.
 * - **backup** — a write-mostly mirror of everything durable, so a corrupted or deleted
 *   object has somewhere to come back from. R2 has no object versioning, so without this
 *   there is no undelete at all.
 *
 * Splitting them is what removes a whole class of accident. Before, one bucket held both the
 * page images and the raw uploads, the bucket had a public hostname because the images need
 * one, and the *only* thing keeping the uploads unreadable was a Cloudflare WAF rule listing
 * the public prefixes. Delete that rule and every original ever uploaded was downloadable,
 * with nothing else to stop it. A bucket with no hostname cannot leak that way.
 *
 * This module is pure and has no dependencies: the routing table is the security boundary,
 * so it is the part that must be readable in one screen and testable without a bucket.
 */

export const STORAGE_PROFILES = ['public', 'private', 'backup'] as const
export type StorageProfile = (typeof STORAGE_PROFILES)[number]

/** The profiles an ordinary key can route to. `backup` is only ever addressed explicitly. */
export type RoutableProfile = Exclude<StorageProfile, 'backup'>

/**
 * The prefixes a reader's browser loads directly, and therefore the only ones that may live
 * behind a public hostname. Adding a prefix here publishes it — there is no second control.
 *
 * This list is one half of a contract with `apps/web/lib/storage/upload.ts` → `storageUrl()`,
 * which builds `<public host>/<key>` for anything it is given. A key that is fetched by a
 * browser but missing from this list gets written to the vault and linked on the image host:
 * a 404, not a leak, but a broken one. `brand/` is here because of exactly that — it holds
 * the operator's uploaded logo, which every page in the site renders.
 *
 * Premium page images are in `pages/` alongside free ones and are *not* private by this
 * split: the app protects them with presigned URLs and unguessable content hashes
 * (docs/03 "Paid content"). That is unchanged, and is still not access control.
 */
export const PUBLIC_PREFIXES = ['covers/', 'banners/', 'pages/', 'avatars/', 'brand/'] as const

/**
 * Objects the app rebuilds whenever it needs them. Mirroring these would cost storage to
 * protect something a job regenerates in seconds, so the mirror skips them.
 */
export const EPHEMERAL_PREFIXES = ['sitemaps/', '_healthcheck/'] as const

const hasPrefix = (key: string, prefixes: readonly string[]): boolean =>
  prefixes.some((prefix) => key.startsWith(prefix))

/**
 * The bucket a key belongs in.
 *
 * Default-deny: anything not named in `PUBLIC_PREFIXES` is private. A prefix added later by
 * someone who did not read this file lands in the bucket with no hostname, which is the
 * failure everybody survives — the other way round publishes it silently.
 */
export const profileForKey = (key: string): RoutableProfile =>
  hasPrefix(key, PUBLIC_PREFIXES) ? 'public' : 'private'

/** True when the object is regenerated on demand and so is not worth mirroring. */
export const isEphemeralKey = (key: string): boolean => hasPrefix(key, EPHEMERAL_PREFIXES)

/** True when losing this object would lose work: everything durable is mirrored. */
export const isMirroredKey = (key: string): boolean => !isEphemeralKey(key)

/**
 * The trees the reconcile sweep walks, with the bucket each lives in. Listing these is much
 * cheaper than asking the mirror about every key one at a time, and it is the whole of what
 * the site stores that would be painful to lose.
 */
export const MIRRORED_PREFIXES: ReadonlyArray<{ profile: RoutableProfile; prefix: string }> = [
  ...PUBLIC_PREFIXES.map((prefix) => ({ profile: 'public' as const, prefix })),
  { profile: 'private' as const, prefix: 'uploads/' },
]

/**
 * Where a mirrored copy lives in the backup bucket.
 *
 * Namespaced by source profile rather than written at the same key, because the public and
 * private buckets are separate key spaces that are allowed to collide — and a restore has to
 * know which bucket a copy came from to put it back in the right one.
 */
export const backupKey = (profile: RoutableProfile, key: string): string => `${profile}/${key}`

/** Split a backup key back into the profile it came from and its original key. */
export const parseBackupKey = (key: string): { profile: RoutableProfile; key: string } | null => {
  const slash = key.indexOf('/')
  if (slash <= 0) return null
  const profile = key.slice(0, slash)
  const rest = key.slice(slash + 1)
  if (!rest || (profile !== 'public' && profile !== 'private')) return null
  return { profile, key: rest }
}
