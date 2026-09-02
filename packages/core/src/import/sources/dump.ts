/**
 * A {@link LegacySource} over a `mysqldump` file (docs/09, docs/17 §E).
 *
 * The operator uploads the dump their host's backup produced; this reads it directly, with
 * no MySQL server anywhere. The dump is treated as what it is — a forward-only stream that
 * may be several gigabytes — so:
 *
 * - One **index pass** reads the whole file once and keeps only the small, join-side tables
 *   in memory: terms, the term/taxonomy/relationship rows, the manga chapter and volume
 *   rows, one role per user, and the `wp_postmeta` rows whose `meta_key` the importer
 *   actually maps. Everything else streams past and is dropped.
 * - `listSeries()`, `listBookmarks()`, `listUsers()` and `listComments()` each open a
 *   **fresh pass** and yield rows as they are read, so `wp_posts`, `wp_users` and
 *   `wp_comments` are never held.
 *
 * What that costs in memory, honestly: the retained postmeta is ~1 row per mapped key per
 * series (a few hundred bytes each), one small object per taxonomy row, one string per user
 * role, and — the only entry that scales with the *catalogue* rather than the series count
 * — the page list of every chapter, roughly 40 bytes per page. A 3,000-series library with
 * five million pages is therefore a few hundred MB. Pass `indexPages: false` for a
 * catalogue-only run (`config.skipImages`) and chapters come back with no pages at all.
 *
 * On top of that sits one transient: the tokenizer materialises whatever single column value
 * it is currently reading, even in a table being skipped, so peak use is the index plus the
 * largest value anywhere in the dump. Measured on a synthetic 250 MB dump carrying a 64 MB
 * `wp_options` blob and 4 M postmeta rows: ~33 MB/s per pass, heap settling at 55 MB.
 *
 * A SQL dump contains no image bytes. `readPage()` resolves the stored path against an
 * injected {@link UploadsReader}; with none configured it throws
 * {@link LegacyPageUnavailableError} rather than handing back an empty buffer.
 */
import { readMetaValue } from '../php-serialize.js'
import type {
  ChapterStorage,
  LegacyChapter,
  LegacyComment,
  LegacyPage,
  LegacyPageImage,
  LegacyPost,
  LegacySource,
  LegacyTerm,
  LegacyTermRef,
  LegacyUser,
} from '../source.js'
import {
  parseSqlDump,
  type SqlDumpEvent,
  type SqlInsertRowEvent,
  type SqlLiteral,
  sqlInt,
  sqlString,
} from './sql-stream.js'
import {
  contentTypeForPath,
  type DumpReader,
  isRemotePath,
  joinStoredPath,
  LegacyPageUnavailableError,
  type UploadsReader,
} from './types.js'

/** The tables the adapter reads, by the suffix that follows the configurable prefix. */
const TABLE_SUFFIXES = [
  'posts',
  'postmeta',
  'terms',
  'term_taxonomy',
  'term_relationships',
  'users',
  'usermeta',
  'comments',
  'manga_chapters',
  'manga_chapters_data',
  'manga_volumes',
] as const
type TableKey = (typeof TABLE_SUFFIXES)[number]

/**
 * Column order used only when a dump carries no `CREATE TABLE` and the `INSERT` has no
 * column list (`mysqldump --no-create-info`). WordPress core's layout is fixed; the three
 * `manga_*` tables are the legacy plugin's own, read out of its `inc/database/database.php`.
 */
const DEFAULT_COLUMNS: Readonly<Record<TableKey, readonly string[]>> = {
  posts: [
    'ID',
    'post_author',
    'post_date',
    'post_date_gmt',
    'post_content',
    'post_title',
    'post_excerpt',
    'post_status',
    'comment_status',
    'ping_status',
    'post_password',
    'post_name',
    'to_ping',
    'pinged',
    'post_modified',
    'post_modified_gmt',
    'post_content_filtered',
    'post_parent',
    'guid',
    'menu_order',
    'post_type',
    'post_mime_type',
    'comment_count',
  ],
  postmeta: ['meta_id', 'post_id', 'meta_key', 'meta_value'],
  terms: ['term_id', 'name', 'slug', 'term_group'],
  term_taxonomy: ['term_taxonomy_id', 'term_id', 'taxonomy', 'description', 'parent', 'count'],
  term_relationships: ['object_id', 'term_taxonomy_id', 'term_order'],
  users: [
    'ID',
    'user_login',
    'user_pass',
    'user_nicename',
    'user_email',
    'user_url',
    'user_registered',
    'user_activation_key',
    'user_status',
    'display_name',
  ],
  usermeta: ['umeta_id', 'user_id', 'meta_key', 'meta_value'],
  comments: [
    'comment_ID',
    'comment_post_ID',
    'comment_author',
    'comment_author_email',
    'comment_author_url',
    'comment_author_IP',
    'comment_date',
    'comment_date_gmt',
    'comment_content',
    'comment_karma',
    'comment_approved',
    'comment_agent',
    'comment_type',
    'comment_parent',
    'user_id',
  ],
  manga_chapters: [
    'chapter_id',
    'post_id',
    'volume_id',
    'chapter_name',
    'chapter_name_extend',
    'chapter_slug',
    'storage_in_use',
    'date',
    'date_gmt',
  ],
  manga_chapters_data: ['data_id', 'chapter_id', 'storage', 'data'],
  manga_volumes: ['volume_id', 'post_id', 'volume_name', 'date', 'date_gmt'],
}

/** The `meta_key`s docs/09 pins, plus the families the legacy theme owns. */
const PINNED_META_KEYS = new Set([
  'manga_unique_id',
  '_wp_manga_type',
  '_wp_manga_status',
  '_wp_manga_alternative',
  '_wp_manga_views',
  '_wp_manga_day_views',
  '_wp_manga_week_views',
  '_wp_manga_month_views',
  '_wp_manga_year_views',
  '_manga_reviews',
  '_manga_avarage_reviews',
  'manga_title_badges',
  '_thumbnail_id',
  '_bookmark_data',
  '_bookmark_time',
  '_wp_attached_file',
])

/**
 * Which `wp_postmeta` rows survive the index pass. Everything the docs/09 mapping reads,
 * everything the legacy theme namespaces to itself, and the attachment path — but not the
 * `_edit_lock` / SEO-plugin / page-builder bulk that is most of a real postmeta table.
 */
export const defaultMetaKeyFilter = (key: string): boolean =>
  PINNED_META_KEYS.has(key) ||
  key.startsWith('_wp_manga') ||
  key.startsWith('_manga') ||
  key.startsWith('manga_') ||
  key.startsWith('_bookmark')

const cleanDate = (value: string): string =>
  value === '' || value.startsWith('0000-00-00') ? '' : value

/** Column name → position, so a positional row can be read by name. */
class RowShape {
  private readonly index = new Map<string, number>()
  constructor(columns: readonly string[]) {
    columns.forEach((name, at) => {
      const key = name.toLowerCase()
      if (!this.index.has(key)) this.index.set(key, at)
    })
  }
  at(values: readonly SqlLiteral[], name: string): SqlLiteral | undefined {
    const at = this.index.get(name.toLowerCase())
    return at === undefined ? undefined : values[at]
  }
  text(values: readonly SqlLiteral[], name: string): string {
    return sqlString(this.at(values, name))
  }
  int(values: readonly SqlLiteral[], name: string, fallback = 0): number {
    return sqlInt(this.at(values, name), fallback)
  }
}

interface ChapterRow {
  chapterId: number
  postId: number
  volumeId: number
  name: string
  slug: string
  storageInUse: string
  createdAt: string
}

interface DumpIndex {
  chapterStorage: ChapterStorage
  terms: LegacyTerm[]
  termRefByTaxonomyId: Map<number, LegacyTermRef>
  taxonomyIdsByObject: Map<number, number[]>
  meta: Map<number, Record<string, string>>
  roles: Map<number, string>
  chaptersBySeries: Map<number, ChapterRow[]>
  /** chapter id → storage name → the stored `src` of each page, in order. */
  pagesByChapter: Map<number, Map<string, string[]>>
  volumes: Map<number, string>
  seriesIds: Set<number>
}

export interface DumpSourceStats {
  /** Forward passes over the file so far. One to index, one per streamed list call. */
  passes: number
  bytesRead: number
  /** Rows read per table during the index pass. */
  rowsRead: Readonly<Record<string, number>>
  /** What the index holds — the adapter's entire memory footprint. */
  indexed: {
    terms: number
    termRelationships: number
    metaRows: number
    metaRowsSkipped: number
    userRoles: number
    chapters: number
    pages: number
  }
  warnings: readonly string[]
}

export interface DumpSourceOptions {
  /** Where the dump bytes come from. Called once per pass, must reopen each time. */
  reader: DumpReader
  /** Defaults to `wp_`; the operator sets it in `config.tablePrefix`. */
  tablePrefix?: string
  /** Where page bytes come from. `null` means catalogue-only: `readPage()` will throw. */
  uploads?: UploadsReader | null
  /** Overrides the report label. */
  name?: string
  /**
   * Prefix the theme's stored page `src` is relative to. Madara 1.7.x writes page paths
   * relative to `wp-content/uploads/WP-manga/data/`, and the uploads reader is rooted at
   * `wp-content/uploads`, so this is what bridges the two.
   */
  dataPathPrefix?: string
  /** Which `wp_postmeta` rows to keep. Defaults to {@link defaultMetaKeyFilter}. */
  metaKeyFilter?: (key: string) => boolean
  /** Keep chapter page lists in the index. False for a catalogue-only run. */
  indexPages?: boolean
  /** Meta keys an older, pre-custom-table install kept its chapters under. */
  chapterMetaKeys?: readonly string[]
}

const DEFAULT_CHAPTER_META_KEYS = ['_wp_manga_chapters'] as const

/** Read a `wp_capabilities` value (`a:1:{s:13:"administrator";b:1;}`) down to one role. */
const roleFromCapabilities = (raw: string): string | null => {
  const parsed = readMetaValue(raw)
  if (parsed === null || typeof parsed !== 'object') return null
  if (Array.isArray(parsed)) {
    const first = parsed[0]
    return typeof first === 'string' ? first : null
  }
  for (const [role, enabled] of Object.entries(parsed)) {
    if (enabled === false || enabled === 0 || enabled === '0') continue
    return role
  }
  return null
}

type LooseRecord = Record<string, unknown>

const asRecordList = (value: unknown): LooseRecord[] => {
  if (Array.isArray(value))
    return value.filter((v): v is LooseRecord => typeof v === 'object' && v !== null)
  if (typeof value === 'object' && value !== null)
    return Object.values(value as LooseRecord).filter(
      (v): v is LooseRecord => typeof v === 'object' && v !== null,
    )
  return []
}

const pickString = (row: LooseRecord, ...keys: string[]): string => {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value !== '') return value
    if (typeof value === 'number') return String(value)
  }
  return ''
}

/**
 * Page entries as the theme's JSON writes them: `{"1":{"src":"…","mime":"image/jpeg"}}`.
 * Tolerates a plain array, and entries that are bare strings.
 */
const pageSrcsFromJson = (raw: string): string[] => {
  const parsed = readMetaValue(raw)
  if (parsed === null) return []
  const entries: [string, unknown][] = Array.isArray(parsed)
    ? parsed.map((v, i) => [String(i + 1), v])
    : typeof parsed === 'object'
      ? Object.entries(parsed)
      : []
  // The theme keys pages "1", "2", … — sort numerically so 10 follows 9.
  entries.sort((a, b) => {
    const an = Number.parseFloat(a[0])
    const bn = Number.parseFloat(b[0])
    if (Number.isNaN(an) || Number.isNaN(bn)) return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0
    return an - bn
  })
  const out: string[] = []
  for (const [, value] of entries) {
    if (typeof value === 'string') {
      if (value !== '') out.push(value)
    } else if (typeof value === 'object' && value !== null) {
      const src = pickString(value as LooseRecord, 'src', 'url', 'path')
      if (src !== '') out.push(src)
    }
  }
  return out
}

/** Per-pass state: the column shapes the dump declared, and the ones it implied. */
interface PassContext {
  declared: Map<string, RowShape>
  byColumnList: WeakMap<object, RowShape>
}

const newPassContext = (): PassContext => ({
  declared: new Map(),
  byColumnList: new WeakMap(),
})

export class MysqlDumpSource implements LegacySource {
  readonly name: string
  private readonly reader: DumpReader
  private readonly uploads: UploadsReader | null
  private readonly prefix: string
  private readonly tables: Readonly<Record<TableKey, string>>
  private readonly byName: Map<string, TableKey>
  private readonly dataPathPrefix: string
  private readonly metaKeyFilter: (key: string) => boolean
  private readonly indexPages: boolean
  private readonly chapterMetaKeys: readonly string[]
  private readonly capabilitiesKey: string

  private indexing: Promise<DumpIndex> | null = null
  private readonly rowsRead: Record<string, number> = {}
  private readonly warnings: string[] = []
  private readonly warned = new Set<string>()
  private passes = 0
  private bytesRead = 0
  private metaRowsSkipped = 0
  private chapterMetaRows = 0
  private pagesIndexed = 0

  constructor(options: DumpSourceOptions) {
    this.reader = options.reader
    this.uploads = options.uploads ?? null
    this.prefix = options.tablePrefix ?? 'wp_'
    const tables = {} as Record<TableKey, string>
    this.byName = new Map()
    for (const suffix of TABLE_SUFFIXES) {
      const name = `${this.prefix}${suffix}`.toLowerCase()
      tables[suffix] = name
      this.byName.set(name, suffix)
    }
    this.tables = tables
    this.capabilitiesKey = `${this.prefix}capabilities`
    this.dataPathPrefix = options.dataPathPrefix ?? 'WP-manga/data/'
    this.metaKeyFilter = options.metaKeyFilter ?? defaultMetaKeyFilter
    this.indexPages = options.indexPages ?? true
    this.chapterMetaKeys = options.chapterMetaKeys ?? DEFAULT_CHAPTER_META_KEYS
    this.name = options.name ?? `${this.reader.name} (mysqldump, prefix ${this.prefix})`
  }

  /** What the adapter has read and what it is holding. Safe to call at any point. */
  stats(): DumpSourceStats {
    return {
      passes: this.passes,
      bytesRead: this.bytesRead,
      rowsRead: { ...this.rowsRead },
      indexed: {
        terms: this.cached?.terms.length ?? 0,
        termRelationships: this.cached?.taxonomyIdsByObject.size ?? 0,
        metaRows: this.cached ? countMetaRows(this.cached.meta) : 0,
        metaRowsSkipped: this.metaRowsSkipped,
        userRoles: this.cached?.roles.size ?? 0,
        chapters: this.cached ? countChapters(this.cached.chaptersBySeries) : 0,
        pages: this.pagesIndexed,
      },
      warnings: [...this.warnings],
    }
  }

  private cached: DumpIndex | null = null

  private warn(message: string): void {
    if (this.warned.has(message)) return
    this.warned.add(message)
    this.warnings.push(message)
  }

  // -- reading -------------------------------------------------------------

  private async *events(want: ReadonlySet<TableKey>): AsyncIterable<SqlDumpEvent> {
    this.passes += 1
    const wanted = new Set<string>()
    for (const key of want) wanted.add(this.tables[key])
    const source = this.reader.open()
    const self = this
    async function* counted(): AsyncIterable<Uint8Array | string> {
      for await (const chunk of source) {
        self.bytesRead += typeof chunk === 'string' ? chunk.length : chunk.byteLength
        yield chunk
      }
    }
    yield* parseSqlDump(counted(), { wantTable: (table) => wanted.has(table) })
  }

  /** The shape a row should be read with: its own column list, the CREATE, or the default. */
  private shapeFor(event: SqlInsertRowEvent, ctx: PassContext): RowShape | null {
    const columns = event.columns
    if (columns !== null && columns.length > 0) {
      const key = columns as unknown as object
      const cached = ctx.byColumnList.get(key)
      if (cached) return cached
      const shape = new RowShape(columns)
      ctx.byColumnList.set(key, shape)
      return shape
    }
    const declared = ctx.declared.get(event.table)
    if (declared) return declared
    const suffix = this.byName.get(event.table)
    if (suffix === undefined) return null
    this.warn(
      `${event.table} has no CREATE TABLE in the dump and its INSERT has no column list; assuming the standard column order.`,
    )
    const shape = new RowShape(DEFAULT_COLUMNS[suffix])
    ctx.declared.set(event.table, shape)
    return shape
  }

  private count(table: string): void {
    this.rowsRead[table] = (this.rowsRead[table] ?? 0) + 1
  }

  // -- the index pass ------------------------------------------------------

  private index(): Promise<DumpIndex> {
    this.indexing ??= this.buildIndex()
    return this.indexing
  }

  private async buildIndex(): Promise<DumpIndex> {
    const ctx = newPassContext()
    const index: DumpIndex = {
      chapterStorage: 'unknown',
      terms: [],
      termRefByTaxonomyId: new Map(),
      taxonomyIdsByObject: new Map(),
      meta: new Map(),
      roles: new Map(),
      chaptersBySeries: new Map(),
      pagesByChapter: new Map(),
      volumes: new Map(),
      seriesIds: new Set(),
    }
    // wp_terms and wp_term_taxonomy arrive in either order, so hold the names separately
    // and join once the pass is done.
    const termNames = new Map<number, { name: string; slug: string }>()
    const taxonomyRows: { ttId: number; termId: number; taxonomy: string; count: number }[] = []

    const want = new Set<TableKey>([
      'posts',
      'postmeta',
      'terms',
      'term_taxonomy',
      'term_relationships',
      'usermeta',
      'manga_chapters',
      'manga_chapters_data',
      'manga_volumes',
    ])

    for await (const event of this.events(want)) {
      if (event.kind === 'create-table') {
        ctx.declared.set(event.table, new RowShape(event.columns))
        continue
      }
      const suffix = this.byName.get(event.table)
      if (suffix === undefined) continue
      const shape = this.shapeFor(event, ctx)
      if (shape === null) continue
      const v = event.values
      this.count(event.table)

      switch (suffix) {
        case 'posts': {
          // Only the identity is kept: the rows themselves are streamed on demand.
          const type = shape.text(v, 'post_type')
          if (type === 'wp-manga') index.seriesIds.add(shape.int(v, 'ID'))
          break
        }
        case 'postmeta': {
          const key = shape.text(v, 'meta_key')
          if (!this.metaKeyFilter(key)) {
            this.metaRowsSkipped += 1
            break
          }
          if (this.chapterMetaKeys.includes(key)) this.chapterMetaRows += 1
          const postId = shape.int(v, 'post_id')
          let bag = index.meta.get(postId)
          if (bag === undefined) {
            bag = {}
            index.meta.set(postId, bag)
          }
          // WordPress allows repeats; the mapping reads the first, as `get_post_meta` does.
          if (!(key in bag)) bag[key] = shape.text(v, 'meta_value')
          break
        }
        case 'terms': {
          termNames.set(shape.int(v, 'term_id'), {
            name: shape.text(v, 'name'),
            slug: shape.text(v, 'slug'),
          })
          break
        }
        case 'term_taxonomy': {
          taxonomyRows.push({
            ttId: shape.int(v, 'term_taxonomy_id'),
            termId: shape.int(v, 'term_id'),
            taxonomy: shape.text(v, 'taxonomy'),
            count: shape.int(v, 'count'),
          })
          break
        }
        case 'term_relationships': {
          const objectId = shape.int(v, 'object_id')
          const list = index.taxonomyIdsByObject.get(objectId)
          if (list === undefined)
            index.taxonomyIdsByObject.set(objectId, [shape.int(v, 'term_taxonomy_id')])
          else list.push(shape.int(v, 'term_taxonomy_id'))
          break
        }
        case 'usermeta': {
          if (shape.text(v, 'meta_key') !== this.capabilitiesKey) break
          const role = roleFromCapabilities(shape.text(v, 'meta_value'))
          if (role !== null) index.roles.set(shape.int(v, 'user_id'), role)
          break
        }
        case 'manga_chapters': {
          const postId = shape.int(v, 'post_id')
          const extend = shape.text(v, 'chapter_name_extend').trim()
          const base = shape.text(v, 'chapter_name')
          const row: ChapterRow = {
            chapterId: shape.int(v, 'chapter_id'),
            postId,
            volumeId: shape.int(v, 'volume_id'),
            // The theme renders `chapter_name` + " - " + `chapter_name_extend`.
            name: extend === '' ? base : `${base} - ${extend}`,
            slug: shape.text(v, 'chapter_slug'),
            storageInUse: shape.text(v, 'storage_in_use'),
            createdAt: cleanDate(shape.text(v, 'date_gmt')) || cleanDate(shape.text(v, 'date')),
          }
          const list = index.chaptersBySeries.get(postId)
          if (list === undefined) index.chaptersBySeries.set(postId, [row])
          else list.push(row)
          break
        }
        case 'manga_chapters_data': {
          if (!this.indexPages) break
          const chapterId = shape.int(v, 'chapter_id')
          const srcs = pageSrcsFromJson(shape.text(v, 'data'))
          const storage = shape.text(v, 'storage') || 'local'
          let byStorage = index.pagesByChapter.get(chapterId)
          if (byStorage === undefined) {
            byStorage = new Map()
            index.pagesByChapter.set(chapterId, byStorage)
          }
          byStorage.set(storage, srcs)
          this.pagesIndexed += srcs.length
          break
        }
        case 'manga_volumes': {
          index.volumes.set(shape.int(v, 'volume_id'), shape.text(v, 'volume_name'))
          break
        }
        default:
          break
      }
    }

    for (const row of taxonomyRows) {
      const term = termNames.get(row.termId)
      const entry: LegacyTerm = {
        termId: row.termId,
        taxonomy: row.taxonomy,
        slug: term?.slug ?? '',
        name: term?.name ?? '',
        count: row.count,
      }
      index.terms.push(entry)
      index.termRefByTaxonomyId.set(row.ttId, {
        taxonomy: entry.taxonomy,
        slug: entry.slug,
        name: entry.name,
      })
    }

    const chapterRows = countChapters(index.chaptersBySeries)
    if (chapterRows > 0) index.chapterStorage = 'custom-tables'
    else if (this.chapterMetaRows > 0) index.chapterStorage = 'postmeta'
    else index.chapterStorage = 'unknown'

    if (index.chapterStorage === 'unknown')
      this.warn(
        `Neither ${this.tables.manga_chapters} nor a chapter meta key (${this.chapterMetaKeys.join(', ')}) carried any row, so the dump does not say where chapters live.`,
      )
    if (this.rowsRead[this.tables.posts] === undefined)
      this.warn(`The dump contains no ${this.tables.posts} rows — check the table prefix.`)

    this.cached = index
    return index
  }

  // -- LegacySource --------------------------------------------------------

  listSeries(): AsyncIterable<LegacyPost> {
    return this.streamPosts('wp-manga')
  }

  listBookmarks(): AsyncIterable<LegacyPost> {
    return this.streamPosts('manga-bookmark')
  }

  private async *streamPosts(postType: string): AsyncIterable<LegacyPost> {
    const index = await this.index()
    const ctx = newPassContext()
    for await (const event of this.events(new Set<TableKey>(['posts']))) {
      if (event.kind === 'create-table') {
        ctx.declared.set(event.table, new RowShape(event.columns))
        continue
      }
      if (this.byName.get(event.table) !== 'posts') continue
      const shape = this.shapeFor(event, ctx)
      if (shape === null) continue
      const v = event.values
      if (shape.text(v, 'post_type') !== postType) continue
      const id = shape.int(v, 'ID')
      const terms: LegacyTermRef[] = []
      for (const ttId of index.taxonomyIdsByObject.get(id) ?? []) {
        const ref = index.termRefByTaxonomyId.get(ttId)
        if (ref !== undefined) terms.push(ref)
      }
      yield {
        id,
        authorId: shape.int(v, 'post_author'),
        dateGmt: cleanDate(shape.text(v, 'post_date_gmt')) || shape.text(v, 'post_date'),
        modifiedGmt:
          cleanDate(shape.text(v, 'post_modified_gmt')) ||
          cleanDate(shape.text(v, 'post_modified')) ||
          null,
        title: shape.text(v, 'post_title'),
        name: shape.text(v, 'post_name'),
        content: shape.text(v, 'post_content'),
        status: shape.text(v, 'post_status'),
        type: shape.text(v, 'post_type'),
        parent: shape.int(v, 'post_parent'),
        meta: index.meta.get(id) ?? {},
        terms,
      }
    }
  }

  async *listTerms(): AsyncIterable<LegacyTerm> {
    const index = await this.index()
    yield* index.terms
  }

  async *listUsers(): AsyncIterable<LegacyUser> {
    const index = await this.index()
    const ctx = newPassContext()
    for await (const event of this.events(new Set<TableKey>(['users']))) {
      if (event.kind === 'create-table') {
        ctx.declared.set(event.table, new RowShape(event.columns))
        continue
      }
      if (this.byName.get(event.table) !== 'users') continue
      const shape = this.shapeFor(event, ctx)
      if (shape === null) continue
      const v = event.values
      const id = shape.int(v, 'ID')
      yield {
        id,
        login: shape.text(v, 'user_login'),
        email: shape.text(v, 'user_email'),
        displayName: shape.text(v, 'display_name') || null,
        registered: cleanDate(shape.text(v, 'user_registered')),
        role: index.roles.get(id) ?? null,
      }
    }
  }

  async *listComments(): AsyncIterable<LegacyComment> {
    const index = await this.index()
    const ctx = newPassContext()
    // Only comments on series posts are the importer's business; a dump with no wp_posts
    // rows to check against passes them all through rather than silently dropping the lot.
    const filter = index.seriesIds.size > 0
    for await (const event of this.events(new Set<TableKey>(['comments']))) {
      if (event.kind === 'create-table') {
        ctx.declared.set(event.table, new RowShape(event.columns))
        continue
      }
      if (this.byName.get(event.table) !== 'comments') continue
      const shape = this.shapeFor(event, ctx)
      if (shape === null) continue
      const v = event.values
      const postId = shape.int(v, 'comment_post_ID')
      if (filter && !index.seriesIds.has(postId)) continue
      yield {
        id: shape.int(v, 'comment_ID'),
        postId,
        parentId: shape.int(v, 'comment_parent'),
        userId: shape.int(v, 'user_id'),
        authorName: shape.text(v, 'comment_author'),
        authorEmail: shape.text(v, 'comment_author_email') || null,
        dateGmt: cleanDate(shape.text(v, 'comment_date_gmt')) || shape.text(v, 'comment_date'),
        content: shape.text(v, 'comment_content'),
        approved: shape.text(v, 'comment_approved'),
      }
    }
  }

  async *listChapters(seriesPostId: number): AsyncIterable<LegacyChapter> {
    const index = await this.index()
    if (index.chapterStorage === 'postmeta') {
      yield* this.chaptersFromMeta(seriesPostId, index)
      return
    }
    for (const row of index.chaptersBySeries.get(seriesPostId) ?? []) {
      yield {
        chapterId: row.chapterId,
        seriesPostId: row.postId,
        name: row.name,
        slug: row.slug || null,
        volumeName: index.volumes.get(row.volumeId) ?? null,
        createdAt: row.createdAt || null,
        pages: this.pagesFor(row, index),
      }
    }
  }

  private pagesFor(row: ChapterRow, index: DumpIndex): LegacyPage[] {
    const byStorage = index.pagesByChapter.get(row.chapterId)
    if (byStorage === undefined || byStorage.size === 0) return []
    // The plugin keeps one row per storage backend and marks the live one; prefer the local
    // copy, because that is the only one the rsynced uploads tree can actually serve.
    const srcs =
      byStorage.get('local') ??
      (row.storageInUse === '' ? undefined : byStorage.get(row.storageInUse)) ??
      [...byStorage.values()][0] ??
      []
    return srcs.map((src, at) => ({
      idx: at + 1,
      path: isRemotePath(src) ? src : joinStoredPath(this.dataPathPrefix, src),
      attachmentId: null,
    }))
  }

  /**
   * The pre-1.7 layout: the whole chapter list serialised into one `wp_postmeta` row.
   * Best effort by design — the shape varied between builds — so it reads whatever of
   * name/slug/date/pages it recognises and leaves the rest to the review CSV.
   */
  private *chaptersFromMeta(seriesPostId: number, index: DumpIndex): Iterable<LegacyChapter> {
    const bag = index.meta.get(seriesPostId)
    if (bag === undefined) return
    for (const key of this.chapterMetaKeys) {
      const raw = bag[key]
      if (raw === undefined || raw === '') continue
      const rows = asRecordList(readMetaValue(raw))
      let at = 0
      for (const row of rows) {
        at += 1
        const idRaw = pickString(row, 'chapter_id', 'id')
        const parsedId = Number.parseInt(idRaw, 10)
        const pages = asPagesFromMeta(row, this.dataPathPrefix)
        yield {
          chapterId: Number.isNaN(parsedId) ? seriesPostId * 1_000_000 + at : parsedId,
          seriesPostId,
          name: pickString(row, 'chapter_name', 'name', 'chapter_title', 'title'),
          slug: pickString(row, 'chapter_slug', 'slug') || null,
          volumeName: pickString(row, 'volume_name', 'volume') || null,
          createdAt: cleanDate(pickString(row, 'date_gmt', 'chapter_date', 'date')) || null,
          pages: this.indexPages ? pages : [],
        }
      }
      return
    }
  }

  async readPage(page: LegacyPage): Promise<LegacyPageImage> {
    const path = page.path
    if (isRemotePath(path)) throw new LegacyPageUnavailableError('remote-storage', path)
    if (this.uploads === null) throw new LegacyPageUnavailableError('uploads-not-configured', path)
    const bytes = await this.uploads.read(path)
    const filename = path.split('/').pop() || 'page'
    const contentType = contentTypeForPath(filename)
    return contentType === undefined ? { filename, bytes } : { filename, bytes, contentType }
  }

  async chapterStorage(): Promise<ChapterStorage> {
    return (await this.index()).chapterStorage
  }

  /** Release the index. The reader itself owns nothing across calls. */
  async close(): Promise<void> {
    this.indexing = null
    this.cached = null
  }
}

const countChapters = (byPost: ReadonlyMap<number, readonly ChapterRow[]>): number => {
  let total = 0
  for (const list of byPost.values()) total += list.length
  return total
}

const countMetaRows = (meta: ReadonlyMap<number, Record<string, string>>): number => {
  let total = 0
  for (const bag of meta.values()) total += Object.keys(bag).length
  return total
}

const asPagesFromMeta = (row: LooseRecord, prefix: string): LegacyPage[] => {
  const raw = row.chapter_data ?? row.pages ?? row.images ?? row.data
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' && raw !== null
      ? Object.values(raw as LooseRecord)
      : typeof raw === 'string'
        ? pageSrcsFromJson(raw)
        : []
  const pages: LegacyPage[] = []
  for (const entry of list) {
    if (typeof entry === 'number') {
      pages.push({ idx: pages.length + 1, path: '', attachmentId: entry })
      continue
    }
    const src =
      typeof entry === 'string'
        ? entry
        : typeof entry === 'object' && entry !== null
          ? pickString(entry as LooseRecord, 'src', 'url', 'path')
          : ''
    if (src === '') continue
    pages.push({
      idx: pages.length + 1,
      path: isRemotePath(src) ? src : joinStoredPath(prefix, src),
      attachmentId: null,
    })
  }
  return pages
}

/** Build a {@link LegacySource} that reads a mysqldump through the injected readers. */
export const createDumpSource = (options: DumpSourceOptions): MysqlDumpSource =>
  new MysqlDumpSource(options)
