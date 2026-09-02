/**
 * The dataset in `legacy-dataset.ts`, rendered as the `mysqldump` a real WordPress + Madara
 * 1.7.x host would produce.
 *
 * The point of deriving it from the same fixture is that the two adapters become
 * comparable: the dump connector reading this text must produce the *same*
 * {@link LegacySource} output as the in-memory connector reading the objects, which is a
 * much stronger assertion than any hand-written expectation.
 *
 * Pure string building — no filesystem, no adapter import — so it stays safe to reach for
 * from anywhere. Deliberately awkward in the ways a real dump is: `/*!40101 … *\/`
 * conditional comments, `LOCK TABLES`, `SET`, `--` and `#` line comments, a `wp_options`
 * table full of serialised noise, meta keys the importer must drop, one chapter mirrored to
 * a second storage backend, a hex literal, a `_binary` literal, and the column-list form of
 * `INSERT` alongside the positional one.
 */
import {
  legacyBookmarks,
  legacyChapters,
  legacyComments,
  legacySeries,
  legacyTerms,
  legacyUsers,
} from './legacy-dataset.js'

/** The theme's page paths are stored relative to this, and the fixture pages sit under it. */
export const LEGACY_DUMP_DATA_PREFIX = 'wp-content/uploads/'

/** `wp_term_taxonomy.term_taxonomy_id` is deliberately not `term_id`, so the join is real. */
const taxonomyId = (termId: number): number => termId + 4000

const ZERO_DATE = '0000-00-00 00:00:00'

const NUL = String.fromCharCode(0)
const SUB = String.fromCharCode(26)

/** mysqldump's escaping: backslash, both quotes, and the control characters. */
const esc = (value: string): string =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .split(NUL)
    .join('\\0')
    .split(SUB)
    .join('\\Z')

const str = (value: string): string => `'${esc(value)}'`

/** The same string as a `0x…` literal — mysqldump writes these with `--hex-blob`. */
const hex = (value: string): string => {
  const bytes = new TextEncoder().encode(value)
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return `0x${out}`
}

/** The same string behind mysqldump's `_binary` marker. */
const binary = (value: string): string => `_binary '${esc(value)}'`

/** PHP's `json_encode`, which escapes forward slashes. */
const phpJson = (value: unknown): string => JSON.stringify(value).replace(/\//g, '\\/')

type Cell = string | number | null

const cell = (value: Cell): string => {
  if (value === null) return 'NULL'
  if (typeof value === 'number') return String(value)
  return str(value)
}

export interface LegacyDumpOptions {
  /** Table prefix to render, matching `config.tablePrefix`. Default `wp_`. */
  tablePrefix?: string
  /** Emit `CREATE TABLE` blocks. Off exercises the "no schema, positional insert" path. */
  createTables?: boolean
  /** Where chapters live in the rendered dump. */
  chapterStorage?: 'custom-tables' | 'postmeta' | 'none'
  /** Rows per extended `INSERT`. 1 gives one statement per row. */
  rowsPerInsert?: number
  /** Render a handful of columns as hex / `_binary` literals instead of plain strings. */
  literalVariants?: boolean
}

interface TableSpec {
  name: string
  columns: readonly [string, string][]
  keys?: readonly string[]
  autoIncrement?: number
}

const createTable = (spec: TableSpec): string => {
  const body = [
    ...spec.columns.map(([name, type]) => `  \`${name}\` ${type}`),
    ...(spec.keys ?? []).map((k) => `  ${k}`),
  ].join(',\n')
  return [
    '--',
    `-- Table structure for table \`${spec.name}\``,
    '--',
    '',
    `DROP TABLE IF EXISTS \`${spec.name}\`;`,
    '/*!40101 SET @saved_cs_client     = @@character_set_client */;',
    '/*!50503 SET character_set_client = utf8mb4 */;',
    `CREATE TABLE \`${spec.name}\` (`,
    body,
    `) ENGINE=InnoDB${spec.autoIncrement ? ` AUTO_INCREMENT=${spec.autoIncrement}` : ''} DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;`,
    '/*!40101 SET character_set_client = @saved_cs_client */;',
    '',
  ].join('\n')
}

interface InsertOptions {
  columns?: readonly string[]
  rowsPerInsert: number
}

/** A `LOCK TABLES` … `UNLOCK TABLES` data block, exactly as mysqldump frames one. */
const insertBlock = (table: string, rows: readonly string[], options: InsertOptions): string => {
  const out: string[] = [
    '--',
    `-- Dumping data for table \`${table}\``,
    '--',
    '',
    `LOCK TABLES \`${table}\` WRITE;`,
    `/*!40000 ALTER TABLE \`${table}\` DISABLE KEYS */;`,
  ]
  const columnList =
    options.columns === undefined ? '' : ` (${options.columns.map((c) => `\`${c}\``).join(', ')})`
  for (let at = 0; at < rows.length; at += options.rowsPerInsert) {
    const batch = rows.slice(at, at + options.rowsPerInsert)
    out.push(`INSERT INTO \`${table}\`${columnList} VALUES ${batch.join(',\n')};`)
  }
  out.push(`/*!40000 ALTER TABLE \`${table}\` ENABLE KEYS */;`, 'UNLOCK TABLES;', '')
  return out.join('\n')
}

const row = (cells: readonly Cell[]): string => `(${cells.map(cell).join(',')})`

const chapterNameParts = (name: string): [string, string] => {
  const at = name.indexOf(' - ')
  return at < 0 ? [name, ''] : [name.slice(0, at), name.slice(at + 3)]
}

/** `wp-content/uploads/manga/5001/01.jpg` → the `src` the theme actually stores. */
const storedSrc = (path: string): string =>
  path.startsWith(LEGACY_DUMP_DATA_PREFIX) ? path.slice(LEGACY_DUMP_DATA_PREFIX.length) : path

const chapterPagesJson = (paths: readonly string[]): string =>
  phpJson(
    Object.fromEntries(
      paths.map((path, at) => [String(at + 1), { src: storedSrc(path), mime: 'image/jpeg' }]),
    ),
  )

const HEADER = [
  '-- MySQL dump 10.13  Distrib 8.0.36, for Linux (x86_64)',
  '--',
  '-- Host: localhost    Database: wordpress',
  '-- ------------------------------------------------------',
  '-- Server version\t8.0.36-0ubuntu0.22.04.1',
  '',
  '/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;',
  '/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;',
  '/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;',
  '/*!50503 SET NAMES utf8mb4 */;',
  '/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;',
  "/*!40103 SET TIME_ZONE='+00:00' */;",
  '/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;',
  '/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;',
  "/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;",
  '/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;',
  '',
  '# A hash comment, which mysqldump does not write but plenty of hand-edited dumps carry.',
  '',
].join('\n')

const FOOTER = [
  '/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;',
  '',
  '/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;',
  '/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;',
  '/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;',
  '/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;',
  '/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;',
  '',
  '-- Dump completed on 2024-05-01 03:14:07',
  '',
].join('\n')

/** Render the fixture dataset as a mysqldump. */
export const legacyDumpSql = (options: LegacyDumpOptions = {}): string => {
  const p = options.tablePrefix ?? 'wp_'
  const withSchema = options.createTables ?? true
  const storage = options.chapterStorage ?? 'custom-tables'
  const rowsPerInsert = options.rowsPerInsert ?? 3
  const variants = options.literalVariants ?? true
  const opts: InsertOptions = { rowsPerInsert }
  const out: string[] = [HEADER]

  const schema = (spec: TableSpec): void => {
    if (withSchema) out.push(createTable(spec))
  }

  // -- wp_users -------------------------------------------------------------
  schema({
    name: `${p}users`,
    autoIncrement: 5,
    columns: [
      ['ID', 'bigint unsigned NOT NULL AUTO_INCREMENT'],
      ['user_login', "varchar(60) NOT NULL DEFAULT ''"],
      ['user_pass', "varchar(255) NOT NULL DEFAULT ''"],
      ['user_nicename', "varchar(50) NOT NULL DEFAULT ''"],
      ['user_email', "varchar(100) NOT NULL DEFAULT ''"],
      ['user_url', "varchar(100) NOT NULL DEFAULT ''"],
      ['user_registered', `datetime NOT NULL DEFAULT '${ZERO_DATE}'`],
      ['user_activation_key', "varchar(255) NOT NULL DEFAULT ''"],
      ['user_status', "int NOT NULL DEFAULT '0'"],
      ['display_name', "varchar(250) NOT NULL DEFAULT ''"],
    ],
    keys: ['PRIMARY KEY (`ID`)', 'KEY `user_login_key` (`user_login`)'],
  })
  out.push(
    insertBlock(
      `${p}users`,
      legacyUsers.map((u) => {
        const login = variants && u.id === 4 ? binary(u.login) : str(u.login)
        return `(${[
          String(u.id),
          login,
          str('$P$Bx7Yq9Z0m3nGkQx6oV1uJ5H2dLpQ9v.'),
          str(u.login.toLowerCase().replace(/[^a-z0-9]+/g, '-')),
          str(u.email),
          str(''),
          str(u.registered),
          str(''),
          '0',
          str(u.displayName ?? ''),
        ].join(',')})`
      }),
      opts,
    ),
  )

  // -- wp_usermeta (column-list form) --------------------------------------
  schema({
    name: `${p}usermeta`,
    autoIncrement: 40,
    columns: [
      ['umeta_id', 'bigint unsigned NOT NULL AUTO_INCREMENT'],
      ['user_id', "bigint unsigned NOT NULL DEFAULT '0'"],
      ['meta_key', 'varchar(255) DEFAULT NULL'],
      ['meta_value', 'longtext'],
    ],
    keys: ['PRIMARY KEY (`umeta_id`)', 'KEY `user_id` (`user_id`)'],
  })
  const capabilities = (role: string): string => `a:1:{s:${role.length}:"${role}";b:1;}`
  const usermetaRows: string[] = []
  let umetaId = 1
  for (const user of legacyUsers) {
    usermetaRows.push(
      row([umetaId++, user.id, `${p}capabilities`, capabilities(user.role ?? 'subscriber')]),
    )
    // Noise the adapter must ignore.
    usermetaRows.push(row([umetaId++, user.id, `${p}user_level`, '10']))
    usermetaRows.push(row([umetaId++, user.id, 'session_tokens', 'a:0:{}']))
  }
  out.push(
    insertBlock(`${p}usermeta`, usermetaRows, {
      ...opts,
      columns: ['umeta_id', 'user_id', 'meta_key', 'meta_value'],
    }),
  )

  // -- wp_terms (column-list form) and wp_term_taxonomy --------------------
  schema({
    name: `${p}terms`,
    autoIncrement: 30,
    columns: [
      ['term_id', 'bigint unsigned NOT NULL AUTO_INCREMENT'],
      ['name', "varchar(200) NOT NULL DEFAULT ''"],
      ['slug', "varchar(200) NOT NULL DEFAULT ''"],
      ['term_group', "bigint NOT NULL DEFAULT '0'"],
    ],
    keys: ['PRIMARY KEY (`term_id`)', 'KEY `slug` (`slug`(191))'],
  })
  out.push(
    insertBlock(
      `${p}terms`,
      legacyTerms.map(
        (t) =>
          `(${[
            String(t.termId),
            variants && t.termId === 22 ? hex(t.name) : str(t.name),
            str(t.slug),
            '0',
          ].join(',')})`,
      ),
      { ...opts, columns: ['term_id', 'name', 'slug', 'term_group'] },
    ),
  )

  schema({
    name: `${p}term_taxonomy`,
    autoIncrement: 4030,
    columns: [
      ['term_taxonomy_id', 'bigint unsigned NOT NULL AUTO_INCREMENT'],
      ['term_id', "bigint unsigned NOT NULL DEFAULT '0'"],
      ['taxonomy', "varchar(32) NOT NULL DEFAULT ''"],
      ['description', 'longtext NOT NULL'],
      ['parent', "bigint unsigned NOT NULL DEFAULT '0'"],
      ['count', "bigint NOT NULL DEFAULT '0'"],
    ],
    keys: [
      'PRIMARY KEY (`term_taxonomy_id`)',
      'UNIQUE KEY `term_id_taxonomy` (`term_id`,`taxonomy`)',
    ],
  })
  out.push(
    insertBlock(
      `${p}term_taxonomy`,
      legacyTerms.map((t) => row([taxonomyId(t.termId), t.termId, t.taxonomy, '', 0, t.count])),
      opts,
    ),
  )

  schema({
    name: `${p}term_relationships`,
    columns: [
      ['object_id', "bigint unsigned NOT NULL DEFAULT '0'"],
      ['term_taxonomy_id', "bigint unsigned NOT NULL DEFAULT '0'"],
      ['term_order', "int NOT NULL DEFAULT '0'"],
    ],
    keys: ['PRIMARY KEY (`object_id`,`term_taxonomy_id`)'],
  })
  const relationshipRows: string[] = []
  for (const post of legacySeries) {
    for (const ref of post.terms) {
      const term = legacyTerms.find((t) => t.taxonomy === ref.taxonomy && t.slug === ref.slug)
      if (term === undefined) continue
      relationshipRows.push(row([post.id, taxonomyId(term.termId), 0]))
    }
  }
  // A blog post carrying the "uncategorised" category — noise the adapter never asks for.
  relationshipRows.push(row([6001, taxonomyId(22), 0]))
  out.push(insertBlock(`${p}term_relationships`, relationshipRows, opts))

  // -- wp_posts -------------------------------------------------------------
  schema({
    name: `${p}posts`,
    autoIncrement: 9100,
    columns: [
      ['ID', 'bigint unsigned NOT NULL AUTO_INCREMENT'],
      ['post_author', "bigint unsigned NOT NULL DEFAULT '0'"],
      ['post_date', 'datetime NOT NULL DEFAULT CURRENT_TIMESTAMP'],
      ['post_date_gmt', 'datetime NOT NULL DEFAULT CURRENT_TIMESTAMP'],
      ['post_content', 'longtext NOT NULL'],
      ['post_title', 'text NOT NULL'],
      ['post_excerpt', 'text NOT NULL'],
      ['post_status', "varchar(20) NOT NULL DEFAULT 'publish'"],
      ['comment_status', "varchar(20) NOT NULL DEFAULT 'open'"],
      ['ping_status', "varchar(20) NOT NULL DEFAULT 'open'"],
      ['post_password', "varchar(255) NOT NULL DEFAULT ''"],
      ['post_name', "varchar(200) NOT NULL DEFAULT ''"],
      ['to_ping', 'text NOT NULL'],
      ['pinged', 'text NOT NULL'],
      ['post_modified', 'datetime NOT NULL DEFAULT CURRENT_TIMESTAMP'],
      ['post_modified_gmt', 'datetime NOT NULL DEFAULT CURRENT_TIMESTAMP'],
      ['post_content_filtered', 'longtext NOT NULL'],
      ['post_parent', "bigint unsigned NOT NULL DEFAULT '0'"],
      ['guid', "varchar(255) NOT NULL DEFAULT ''"],
      ['menu_order', "int NOT NULL DEFAULT '0'"],
      ['post_type', "varchar(20) NOT NULL DEFAULT 'post'"],
      ['post_mime_type', "varchar(100) NOT NULL DEFAULT ''"],
      ['comment_count', "bigint NOT NULL DEFAULT '0'"],
      // The legacy plugin adds this column to wp_posts on activation.
      ['wp_manga_search_text', 'text'],
    ],
    keys: [
      'PRIMARY KEY (`ID`)',
      'KEY `post_name` (`post_name`(191))',
      'KEY `type_status_date` (`post_type`,`post_status`,`post_date`,`ID`)',
    ],
  })
  const postRow = (post: (typeof legacySeries)[number]): string =>
    row([
      post.id,
      post.authorId,
      post.dateGmt,
      post.dateGmt,
      post.content,
      post.title,
      '',
      post.status,
      'open',
      'closed',
      '',
      post.name,
      '',
      '',
      ZERO_DATE,
      ZERO_DATE,
      '',
      0,
      `https://old-site.test/?p=${post.id}`,
      0,
      post.type,
      '',
      0,
      post.title.toLowerCase(),
    ])
  const postRows = [
    ...legacySeries.map(postRow),
    ...legacyBookmarks.map(postRow),
    // A blog post and an attachment, neither of which the importer lists.
    row([
      6001,
      1,
      '2018-02-02 00:00:00',
      '2018-02-02 00:00:00',
      'Hello world, with an apostrophe: it’s fine.',
      'Hello world',
      '',
      'publish',
      'open',
      'open',
      '',
      'hello-world',
      '',
      '',
      ZERO_DATE,
      ZERO_DATE,
      '',
      0,
      'https://old-site.test/?p=6001',
      0,
      'post',
      '',
      3,
      null,
    ]),
    row([
      9001,
      1,
      '2021-03-04 09:00:00',
      '2021-03-04 09:00:00',
      '',
      'ashfall-cover',
      '',
      'inherit',
      'closed',
      'closed',
      '',
      'ashfall-cover',
      '',
      '',
      ZERO_DATE,
      ZERO_DATE,
      '',
      101,
      'https://old-site.test/wp-content/uploads/2021/03/ashfall-cover.jpg',
      0,
      'attachment',
      'image/jpeg',
      0,
      null,
    ]),
  ]
  out.push(insertBlock(`${p}posts`, postRows, opts))

  // -- wp_postmeta ----------------------------------------------------------
  schema({
    name: `${p}postmeta`,
    autoIncrement: 900,
    columns: [
      ['meta_id', 'bigint unsigned NOT NULL AUTO_INCREMENT'],
      ['post_id', "bigint unsigned NOT NULL DEFAULT '0'"],
      ['meta_key', 'varchar(255) DEFAULT NULL'],
      ['meta_value', 'longtext'],
    ],
    keys: [
      'PRIMARY KEY (`meta_id`)',
      'KEY `post_id` (`post_id`)',
      'KEY `meta_key` (`meta_key`(191))',
    ],
  })
  const metaRows: string[] = []
  let metaId = 1
  const noise = (postId: number): void => {
    metaRows.push(row([metaId++, postId, '_edit_lock', '1714521600:1']))
    metaRows.push(row([metaId++, postId, '_yoast_wpseo_title', '%%title%% %%page%% %%sep%%']))
    metaRows.push(row([metaId++, postId, '_elementor_data', '[{"id":"a1b2","elType":"section"}]']))
  }
  for (const post of [...legacySeries, ...legacyBookmarks]) {
    for (const [key, value] of Object.entries(post.meta)) {
      metaRows.push(row([metaId++, post.id, key, value]))
    }
    noise(post.id)
  }
  metaRows.push(row([metaId++, 9001, '_wp_attached_file', '2021/03/ashfall-cover.jpg']))
  if (storage === 'postmeta') {
    for (const post of legacySeries) {
      const chapters = legacyChapters.filter((c) => c.seriesPostId === post.id)
      if (chapters.length === 0) continue
      metaRows.push(
        row([
          metaId++,
          post.id,
          '_wp_manga_chapters',
          phpJson(
            chapters.map((c) => ({
              chapter_id: c.chapterId,
              chapter_name: c.name,
              chapter_slug: c.slug ?? '',
              date_gmt: c.createdAt ?? '',
              chapter_data: c.pages.map((page) => ({
                src: storedSrc(page.path),
                mime: 'image/jpeg',
              })),
            })),
          ),
        ]),
      )
    }
  }
  out.push(insertBlock(`${p}postmeta`, metaRows, opts))

  // -- wp_comments ----------------------------------------------------------
  schema({
    name: `${p}comments`,
    autoIncrement: 8100,
    columns: [
      ['comment_ID', 'bigint unsigned NOT NULL AUTO_INCREMENT'],
      ['comment_post_ID', "bigint unsigned NOT NULL DEFAULT '0'"],
      ['comment_author', 'tinytext NOT NULL'],
      ['comment_author_email', "varchar(100) NOT NULL DEFAULT ''"],
      ['comment_author_url', "varchar(200) NOT NULL DEFAULT ''"],
      ['comment_author_IP', "varchar(100) NOT NULL DEFAULT ''"],
      ['comment_date', `datetime NOT NULL DEFAULT '${ZERO_DATE}'`],
      ['comment_date_gmt', `datetime NOT NULL DEFAULT '${ZERO_DATE}'`],
      ['comment_content', 'text NOT NULL'],
      ['comment_karma', "int NOT NULL DEFAULT '0'"],
      ['comment_approved', "varchar(20) NOT NULL DEFAULT '1'"],
      ['comment_agent', "varchar(255) NOT NULL DEFAULT ''"],
      ['comment_type', "varchar(20) NOT NULL DEFAULT 'comment'"],
      ['comment_parent', "bigint unsigned NOT NULL DEFAULT '0'"],
      ['user_id', "bigint unsigned NOT NULL DEFAULT '0'"],
    ],
    keys: ['PRIMARY KEY (`comment_ID`)', 'KEY `comment_post_ID` (`comment_post_ID`)'],
  })
  const commentRows = [
    ...legacyComments.map((c) =>
      row([
        c.id,
        c.postId,
        c.authorName,
        c.authorEmail ?? '',
        '',
        '',
        c.dateGmt,
        c.dateGmt,
        c.content,
        0,
        c.approved,
        'Mozilla/5.0',
        'comment',
        c.parentId,
        c.userId,
      ]),
    ),
    // On the blog post, not a series: the adapter must not carry it across.
    row([
      8100,
      6001,
      'someone',
      'someone@old-site.test',
      '',
      '',
      '2023-03-03 10:00:00',
      '2023-03-03 10:00:00',
      'Not a manga comment.',
      0,
      '1',
      'Mozilla/5.0',
      'comment',
      0,
      0,
    ]),
  ]
  out.push(insertBlock(`${p}comments`, commentRows, opts))

  // -- the plugin's own tables ---------------------------------------------
  if (storage === 'custom-tables') {
    schema({
      name: `${p}manga_volumes`,
      autoIncrement: 2,
      columns: [
        ['volume_id', 'bigint(20) NOT NULL AUTO_INCREMENT'],
        ['post_id', 'bigint(20) NOT NULL'],
        ['volume_name', 'text NOT NULL'],
        ['date', `datetime DEFAULT '${ZERO_DATE}' NOT NULL`],
        ['date_gmt', `datetime DEFAULT '${ZERO_DATE}' NOT NULL`],
      ],
      keys: ['PRIMARY KEY (`volume_id`)'],
    })
    out.push(
      insertBlock(
        `${p}manga_volumes`,
        [row([1, 101, 'Volume 1', '2021-03-04 09:15:00', '2021-03-04 09:15:00'])],
        opts,
      ),
    )

    schema({
      name: `${p}manga_chapters`,
      autoIncrement: 5011,
      columns: [
        ['chapter_id', 'bigint(20) NOT NULL AUTO_INCREMENT'],
        ['post_id', 'bigint(20) NOT NULL'],
        ['volume_id', 'bigint(20) NULL'],
        ['chapter_name', 'text NOT NULL'],
        ['chapter_name_extend', 'text NOT NULL'],
        ['chapter_slug', 'text NOT NULL'],
        ['storage_in_use', 'varchar(20) NULL'],
        ['date', `datetime DEFAULT '${ZERO_DATE}' NOT NULL`],
        ['date_gmt', `datetime DEFAULT '${ZERO_DATE}' NOT NULL`],
      ],
      keys: ['PRIMARY KEY (`chapter_id`)', 'KEY `manga_chapter_index_1` (`post_id`)'],
    })
    out.push(
      insertBlock(
        `${p}manga_chapters`,
        legacyChapters.map((c) => {
          const [name, extend] = chapterNameParts(c.name)
          return row([
            c.chapterId,
            c.seriesPostId,
            0,
            name,
            extend,
            c.slug ?? '',
            'local',
            c.createdAt ?? ZERO_DATE,
            c.createdAt ?? ZERO_DATE,
          ])
        }),
        opts,
      ),
    )

    schema({
      name: `${p}manga_chapters_data`,
      autoIncrement: 6011,
      columns: [
        ['data_id', 'bigint(20) NOT NULL AUTO_INCREMENT'],
        ['chapter_id', 'bigint(20) NOT NULL'],
        ['storage', 'varchar(20) NOT NULL'],
        ['data', 'longtext NOT NULL'],
      ],
      keys: [
        'PRIMARY KEY (`data_id`)',
        'KEY `manga_chapter_data_index_2` (`chapter_id`,`storage`)',
      ],
    })
    const dataRows = legacyChapters.map((c, at) =>
      row([6001 + at, c.chapterId, 'local', chapterPagesJson(c.pages.map((page) => page.path))]),
    )
    // One chapter also mirrored to a cloud backend; the local copy must still win.
    dataRows.push(
      row([
        6100,
        5005,
        'imgur',
        phpJson({ '1': { src: 'https://i.imgur.com/abc123.jpg', mime: 'image/jpeg' } }),
      ]),
    )
    out.push(insertBlock(`${p}manga_chapters_data`, dataRows, opts))
  }

  // -- noise ---------------------------------------------------------------
  schema({
    name: `${p}options`,
    autoIncrement: 200,
    columns: [
      ['option_id', 'bigint unsigned NOT NULL AUTO_INCREMENT'],
      ['option_name', "varchar(191) NOT NULL DEFAULT ''"],
      ['option_value', 'longtext NOT NULL'],
      ['autoload', "varchar(20) NOT NULL DEFAULT 'yes'"],
    ],
    keys: ['PRIMARY KEY (`option_id`)', 'UNIQUE KEY `option_name` (`option_name`)'],
  })
  out.push(
    insertBlock(
      `${p}options`,
      [
        row([1, 'siteurl', 'https://old-site.test', 'yes']),
        // Quotes, semicolons, backslashes and newlines inside a value the adapter skips:
        // if the tokenizer got any of it wrong, the statement boundary would move.
        row([
          2,
          'madara_settings',
          'a:3:{s:5:"theme";s:6:"madara";s:5:"quote";s:21:"it\'s a \\"quoted\\" word";s:4:"note";s:24:"line one;\nline two; done";}',
          'yes',
        ]),
        row([
          3,
          'cron',
          'a:1:{i:1714521600;a:1:{s:16:"wp_version_check";a:1:{s:32:"40cd750bba9870f18aada2478b24840a";a:3:{s:8:"schedule";s:10:"twicedaily";s:4:"args";a:0:{}s:8:"interval";i:43200;}}}}',
          'yes',
        ]),
      ],
      opts,
    ),
  )
  out.push(FOOTER)
  return out.join('\n')
}
