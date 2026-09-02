/**
 * The legacy WordPress source, as an adapter (docs/09, docs/17 §E).
 *
 * Everything the importer knows about the old site arrives through this interface, so the
 * mapping and reporting code below is pure, framework-free and unit-testable, and never
 * talks to MySQL itself. Concrete adapters (a live DSN, a mysqldump file, the in-memory
 * fixture in `__fixtures__/`) implement it.
 */

/** A taxonomy term attached to a post: `wp-manga-genre`, `-author`, `-artist`, `-tag`, `-release`. */
export interface LegacyTermRef {
  taxonomy: string
  slug: string
  name: string
}

/** One `wp_posts` row, narrowed to the columns the importer reads, with its meta flattened. */
export interface LegacyPost {
  id: number
  authorId: number
  /** `post_date_gmt`, ISO-8601 or `YYYY-MM-DD HH:MM:SS`. */
  dateGmt: string
  modifiedGmt?: string | null
  /** `post_title`. */
  title: string
  /** `post_name` — the slug the legacy URL used. */
  name: string
  /** `post_content`. */
  content: string
  /** `post_status`: publish · draft · pending · private · trash. */
  status: string
  /** `post_type`: `wp-manga`, `manga-bookmark`, `attachment`, … */
  type: string
  parent?: number
  /** `wp_postmeta` flattened to `meta_key` → first `meta_value`. */
  meta: Readonly<Record<string, string>>
  /** `wp_term_relationships` resolved to terms. */
  terms: readonly LegacyTermRef[]
}

/** A row of `wp_terms` + `wp_term_taxonomy`. */
export interface LegacyTerm {
  termId: number
  taxonomy: string
  slug: string
  name: string
  /** `wp_term_taxonomy.count`. */
  count: number
}

/** One page of a chapter, in stored order. */
export interface LegacyPage {
  idx: number
  /** Path relative to the uploads root, or an absolute path on the importer's disk. */
  path: string
  attachmentId?: number | null
}

/** A row of the plugin's `wp_manga_chapters` custom table (v1.7.x). */
export interface LegacyChapter {
  chapterId: number
  seriesPostId: number
  /** The display name the theme stores: "Chapter 154", "Ch.12.5", "Vol.2 Ch.3". */
  name: string
  /** `chapter_slug` — the segment the legacy chapter URL used, e.g. `chapter-154`. */
  slug?: string | null
  volumeName?: string | null
  createdAt?: string | null
  pages: readonly LegacyPage[]
}

/** A row of `wp_users` (+ its `wp_capabilities` role). */
export interface LegacyUser {
  id: number
  login: string
  email: string
  displayName?: string | null
  /** `user_registered`. */
  registered: string
  /** `administrator` · `editor` · `author` · `subscriber` … */
  role?: string | null
}

/** A row of `wp_comments` on a `wp-manga` post. */
export interface LegacyComment {
  id: number
  postId: number
  parentId: number
  userId: number
  authorName: string
  authorEmail?: string | null
  dateGmt: string
  /** Stored HTML. */
  content: string
  /** `comment_approved`: '1' · '0' · 'spam' · 'trash'. */
  approved: string
}

/** The bytes of one legacy page image, handed to the `chapter.process` pipeline unchanged. */
export interface LegacyPageImage {
  filename: string
  bytes: Uint8Array
  contentType?: string
}

/** Where the plugin keeps chapters — v1.7.x uses its own tables, older builds used postmeta. */
export type ChapterStorage = 'custom-tables' | 'postmeta' | 'unknown'

export interface LegacySource {
  /** Human label for the report ("mysql://…/wp" with the password masked, or "sample dataset"). */
  readonly name: string
  /** `post_type = 'wp-manga'`. */
  listSeries(): AsyncIterable<LegacyPost>
  listChapters(seriesPostId: number): AsyncIterable<LegacyChapter>
  listTerms(): AsyncIterable<LegacyTerm>
  listUsers(): AsyncIterable<LegacyUser>
  /** `post_type = 'manga-bookmark'` — payload in `_bookmark_data` / `_bookmark_time`. */
  listBookmarks(): AsyncIterable<LegacyPost>
  listComments(): AsyncIterable<LegacyComment>
  readPage(page: LegacyPage): Promise<LegacyPageImage>
  chapterStorage(): Promise<ChapterStorage>
  close?(): Promise<void>
}

/** Collect an async iterable — the reports are small enough to hold, the import is not. */
export const collect = async <T>(it: AsyncIterable<T>): Promise<T[]> => {
  const out: T[] = []
  for await (const v of it) out.push(v)
  return out
}
