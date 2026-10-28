import { directUrlProblem } from './address.js'
import { imgchestUrl, parseImgchestId } from './imgchest.js'
import { imgurAlbumUrl, parseImgurId } from './imgur.js'
import { GalleryError, type GalleryProvider } from './types.js'

/**
 * Cubari-style series manifests — the "paste a git link and the whole series appears" shape.
 *
 * Verified against eleven published manifests (210 chapters) rather than a blog post:
 *
 *   {
 *     "title": "...", "description": "...", "author": "...", "artist": "...",
 *     "cover": "https://...",
 *     "chapters": {
 *       "1":   { "title": "...", "volume": "1",
 *                "groups": { "Some Group": "/proxy/api/imgur/chapter/mPTTseC/" },
 *                "last_updated": "1617673932" },
 *       "3.1": { ... }
 *     }
 *   }
 *
 * Chapter keys are decimal strings, so `3.1` is a real and common key — this is why chapter
 * numbers are numeric(10,3) and not integers. `groups` maps a scanlator name to that group's
 * pages, which in practice is a Cubari proxy path but is also commonly a plain array of
 * image URLs; both are read, because refusing the array form would reject hand-written
 * manifests for no reason.
 *
 * Nothing here touches the network. A manifest resolves to a list of intents — "chapter 12,
 * from this Imgur album" — and the caller decides what to do with each one.
 */

export interface ManifestChapter {
  /** The key as written, e.g. `3.1`. */
  key: string
  number: number
  title: string | null
  volume: number | null
  /** The scanlator name from `groups`, kept so it can be matched to a group row. */
  group: string | null
  source:
    | { kind: 'gallery'; provider: GalleryProvider; id: string }
    | { kind: 'direct'; links: string[] }
  /** `last_updated`, seconds since the epoch, when present and sane. */
  updatedAt: Date | null
}

export interface Manifest {
  title: string | null
  description: string | null
  author: string | null
  artist: string | null
  cover: string | null
  chapters: ManifestChapter[]
  /**
   * Entries that could not be read, with the reason.
   *
   * Collected rather than thrown. A 200-chapter manifest with three broken entries should
   * import 197 chapters and tell the operator about the three — failing the whole file
   * because one group string is malformed would make the feature useless on exactly the
   * large manifests it exists for.
   */
  skipped: Array<{ key: string; reason: string }>
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null

/** `"1"` as a volume, and `"Volume 3"` too, because manifests are hand-written. */
const volumeOf = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  const match = typeof value === 'string' ? /(\d+)/.exec(value) : null
  return match?.[1] ? Number(match[1]) : null
}

const updatedAtOf = (value: unknown): Date | null => {
  const seconds = Number(value)
  // Sanity bounds rather than a bare parse: manifests carry both seconds and milliseconds,
  // and a 1970 or a year-50000 timestamp on every chapter is worse than none.
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  const ms = seconds > 10_000_000_000 ? seconds : seconds * 1000
  const date = new Date(ms)
  const year = date.getUTCFullYear()
  return year >= 1990 && year <= 2100 ? date : null
}

/**
 * One `groups` value to a page source.
 *
 * Three forms, all seen in the wild: a Cubari proxy path, a plain array of direct image
 * URLs, and a bare gallery link somebody pasted in place of a proxy path.
 */
const sourceOf = (value: unknown): ManifestChapter['source'] => {
  if (Array.isArray(value)) {
    const links: string[] = []
    for (const [i, entry] of value.entries()) {
      if (typeof entry !== 'string' || entry.trim() === '')
        throw new GalleryError('unparseable', `image ${i + 1} is not a URL`)
      const problem = directUrlProblem(entry.trim())
      if (problem)
        throw new GalleryError(problem === 'host' ? 'bad_image_host' : 'bad_url', `image ${i + 1}`)
      links.push(entry.trim())
    }
    if (links.length === 0) throw new GalleryError('empty', 'no images')
    return { kind: 'direct', links }
  }
  if (typeof value !== 'string' || value.trim() === '')
    throw new GalleryError('unparseable', 'group is neither a path nor a list')
  const raw = value.trim()

  const proxied = /^\/proxy\/api\/([a-z]+)\/chapter\/([^/]+)\/?$/i.exec(raw)
  if (proxied) {
    const [, host = '', id = ''] = proxied
    const provider = host.toLowerCase()
    if (provider === 'imgur') {
      const parsed = parseImgurId(id)
      if (!parsed) throw new GalleryError('bad_url', `imgur id ${id}`)
      return { kind: 'gallery', provider: 'imgur', id: parsed }
    }
    if (provider === 'imgchest') {
      const parsed = parseImgchestId(id)
      if (!parsed) throw new GalleryError('bad_url', `imgchest id ${id}`)
      return { kind: 'gallery', provider: 'imgchest', id: parsed }
    }
    // gist, mangadex, guya and the rest: understood enough to name, not to import.
    throw new GalleryError('unparseable', `unsupported source "${provider}"`)
  }

  // A pasted gallery link rather than a proxy path.
  const chest = parseImgchestId(raw)
  if (chest) return { kind: 'gallery', provider: 'imgchest', id: chest }
  const imgur = parseImgurId(raw)
  if (imgur) return { kind: 'gallery', provider: 'imgur', id: imgur }
  throw new GalleryError('unparseable', 'group is not a source we can read')
}

/**
 * Which group to take when a chapter has several.
 *
 * Cubari shows them all and lets the reader choose; we import one chapter per number per
 * language, so one has to be picked. `preferred` is the operator's answer when they know the
 * group they want; otherwise the first, which in every manifest examined is the only one.
 */
const pickGroup = (
  groups: Record<string, unknown>,
  preferred: string | null,
): [string, unknown] | null => {
  const entries = Object.entries(groups)
  if (entries.length === 0) return null
  if (preferred) {
    const wanted = preferred.toLowerCase()
    const hit = entries.find(([name]) => name.toLowerCase() === wanted)
    if (hit) return hit
  }
  return entries[0] ?? null
}

export const parseManifest = (body: unknown, opts: { group?: string | null } = {}): Manifest => {
  const root = asRecord(body)
  if (!root) throw new GalleryError('unparseable', 'manifest is not an object')
  const chapters = asRecord(root.chapters)
  if (!chapters) throw new GalleryError('unparseable', 'manifest has no chapters object')

  const out: ManifestChapter[] = []
  const skipped: Manifest['skipped'] = []
  for (const [key, value] of Object.entries(chapters)) {
    const number = Number(key)
    if (!Number.isFinite(number) || number < 0 || number > 99_999) {
      skipped.push({ key, reason: 'not a chapter number' })
      continue
    }
    const chapter = asRecord(value)
    if (!chapter) {
      skipped.push({ key, reason: 'not an object' })
      continue
    }
    const groups = asRecord(chapter.groups)
    if (!groups) {
      skipped.push({ key, reason: 'no groups' })
      continue
    }
    const picked = pickGroup(groups, opts.group ?? null)
    if (!picked) {
      skipped.push({ key, reason: 'no groups' })
      continue
    }
    try {
      out.push({
        key,
        number,
        title: text(chapter.title),
        volume: volumeOf(chapter.volume),
        group: picked[0],
        source: sourceOf(picked[1]),
        updatedAt: updatedAtOf(chapter.last_updated),
      })
    } catch (error) {
      skipped.push({
        key,
        reason: error instanceof GalleryError ? `${error.code}: ${error.message}` : 'unreadable',
      })
    }
  }

  // Numeric order, not the object's key order: JSON objects keep insertion order and
  // manifests are appended to, so "1, 10, 11, 2" is the normal state of a hand-edited file.
  out.sort((a, b) => a.number - b.number)
  if (out.length === 0)
    throw new GalleryError('empty', `no readable chapters (${skipped.length} skipped)`)

  const cover = text(root.cover)
  return {
    title: text(root.title),
    description: text(root.description),
    author: text(root.author),
    artist: text(root.artist),
    // The cover is fetched server-side like any other image, so it gets the same check.
    cover: cover && !directUrlProblem(cover) ? cover : null,
    chapters: out,
    skipped,
  }
}

/**
 * The raw-JSON URL for a pasted GitHub or gist link.
 *
 * Operators paste the page they are looking at, not the raw file, and `github.com/.../blob/...`
 * answers with HTML. Rewriting it is the difference between the feature working on the link
 * in someone's clipboard and it not.
 */
export const manifestRawUrl = (input: string): string | null => {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  const host = url.hostname.toLowerCase()
  if (host === 'gist.githubusercontent.com') {
    /**
     * Drop the revision a gist's own Raw button bakes in.
     *
     * `/{user}/{id}/raw/{sha}/{file}` is that gist *as it was*, frozen, forever — and it is
     * precisely the URL GitHub hands you when you click Raw, so it is the one operators
     * paste. Following it faithfully means the file updates, the sync re-reads the same
     * bytes every fifteen minutes, finds nothing new, and reports success. The sync looks
     * healthy while the site falls behind, which is the worst shape a bug can take.
     *
     * `/{user}/{id}/raw/{file}` is the same file at its latest revision.
     */
    const pinned = /^\/([^/]+)\/([0-9a-f]{20,})\/raw\/[0-9a-f]{40}\/(.+)$/.exec(url.pathname)
    if (pinned)
      return `https://gist.githubusercontent.com/${pinned[1]}/${pinned[2]}/raw/${pinned[3]}`
    return url.toString()
  }
  if (host === 'raw.githubusercontent.com') return url.toString()
  if (host === 'github.com') {
    const blob = /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(url.pathname)
    if (blob) return `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}`
    return null
  }
  if (host === 'gist.github.com') {
    // A gist page; `/raw` is appended rather than guessed at the revision.
    const path = url.pathname.replace(/\/$/, '')
    return /^\/[^/]+\/[0-9a-f]{20,}$/.test(path)
      ? `https://gist.githubusercontent.com${path}/raw`
      : null
  }
  return null
}

/**
 * The human-readable origin of one manifest chapter, as `chapters.processing.fetch.url`.
 *
 * Shared because two importers need the same answer: the admin route behind the panel and
 * the worker's unattended sync. Two spellings of this would mean a chapter imported by the
 * sync recorded a different origin from the same chapter imported by hand — and that field
 * is what the panel shows an operator asking where a chapter came from.
 */
export const manifestChapterUrl = (chapter: ManifestChapter): string =>
  chapter.source.kind === 'direct'
    ? (chapter.source.links[0] ?? '')
    : chapter.source.provider === 'imgur'
      ? imgurAlbumUrl(chapter.source.id)
      : imgchestUrl(chapter.source.id)

/**
 * A digest of what a manifest currently offers, for "has this file changed?".
 *
 * Over the chapter keys and their sources rather than the raw bytes: a manifest served from
 * a gist or a CDN picks up incidental differences — a reformat, a description edit, a key
 * order that JSON does not promise to preserve — and a fingerprint that moves on those would
 * send the sync to the chapter table on every pass for nothing. What matters is whether
 * there is a chapter here that was not here before, or a chapter now pointing somewhere else.
 */
export const manifestFingerprint = (manifest: Manifest): string => {
  const parts = manifest.chapters
    .map((c) =>
      c.source.kind === 'direct'
        ? `${c.key}:direct:${c.source.links.length}:${c.source.links[0] ?? ''}`
        : `${c.key}:${c.source.provider}:${c.source.id}`,
    )
    .sort()
  // djb2 over the joined list: this is a change detector, not a security primitive, and it
  // has to run in the worker without reaching for node:crypto on every pass.
  let hash = 5381
  const joined = parts.join('\n')
  for (let i = 0; i < joined.length; i++) hash = (hash * 33 + joined.charCodeAt(i)) | 0
  return `${parts.length}:${(hash >>> 0).toString(36)}`
}
