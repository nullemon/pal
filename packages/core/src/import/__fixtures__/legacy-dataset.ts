/**
 * A representative legacy dataset behind the {@link LegacySource} interface, in memory.
 * It is the fixture the unit tests map, and the dataset the admin screen's "sample" source
 * runs so an operator can see the report shapes before a real database is wired up.
 *
 * Deliberately awkward: every chapter-name form docs/09 calls out, a trashed series, a
 * series with no `manga_unique_id`, an unknown status value, a spam comment and an orphan
 * bookmark.
 */
import type {
  LegacyChapter,
  LegacyComment,
  LegacyPage,
  LegacyPageImage,
  LegacyPost,
  LegacySource,
  LegacyTerm,
  LegacyUser,
} from '../source.js'

const term = (taxonomy: string, slug: string, name: string) => ({ taxonomy, slug, name })

const genre = (slug: string, name: string) => term('wp-manga-genre', slug, name)
const tag = (slug: string, name: string) => term('wp-manga-tag', slug, name)
const author = (slug: string, name: string) => term('wp-manga-author', slug, name)
const artist = (slug: string, name: string) => term('wp-manga-artist', slug, name)
const release = (year: string) => term('wp-manga-release', year, year)

export const legacySeries: LegacyPost[] = [
  {
    id: 101,
    authorId: 1,
    dateGmt: '2021-03-04 09:15:00',
    title: 'Ashfall Requiem',
    name: 'ashfall-requiem',
    content: '<p>A knight wakes in the ruins of her own capital.</p><p>She is not alone.</p>',
    status: 'publish',
    type: 'wp-manga',
    meta: {
      manga_unique_id: 'mu-ashfall-0001',
      _wp_manga_type: 'manhwa',
      _wp_manga_status: 'on-going',
      _wp_manga_alternative: 'Requiem of Ash, 잿빛 진혼곡, Ashfall Requiem',
      _wp_manga_views: '184213',
      _wp_manga_day_views: '1204',
      _wp_manga_week_views: '9331',
      _wp_manga_month_views: '40122',
      _wp_manga_year_views: '150004',
      _manga_reviews: '412',
      _manga_avarage_reviews: '4.6',
      manga_title_badges: 'hot',
      _thumbnail_id: '9001',
    },
    terms: [
      genre('action', 'Action'),
      genre('fantasy', 'Fantasy'),
      tag('female-lead', 'Female Lead'),
      author('yoon-hae', 'Yoon Hae'),
      artist('kim-doha', 'Kim Doha'),
      release('2021'),
    ],
  },
  {
    id: 102,
    authorId: 1,
    dateGmt: '2019-11-20 12:00:00',
    title: 'The Quiet Blade',
    name: 'the-quiet-blade',
    content: '<p>An assassin retires. The world does not let her.</p>',
    status: 'publish',
    type: 'wp-manga',
    meta: {
      manga_unique_id: 'mu-quiet-0002',
      _wp_manga_type: 'manga',
      _wp_manga_status: 'end',
      _wp_manga_alternative: 'Shizuka na Yaiba',
      _wp_manga_views: '92044',
      _manga_reviews: '210',
      _manga_avarage_reviews: '4.1',
      _thumbnail_id: '9002',
    },
    terms: [
      genre('action', 'Action'),
      genre('drama', 'Drama'),
      author('sato-rin', 'Sato Rin'),
      release('2019'),
    ],
  },
  {
    id: 103,
    authorId: 2,
    dateGmt: '2023-06-01 08:30:00',
    title: 'Cloudbreaker',
    name: '',
    content: 'A cultivator falls out of the sky and into a debt.',
    status: 'draft',
    type: 'wp-manga',
    meta: {
      // No manga_unique_id: the importer must key this on the post id and warn.
      _wp_manga_type: 'manhua',
      _wp_manga_status: 'on-hold',
      _wp_manga_views: '311',
      _manga_reviews: '0',
      _manga_avarage_reviews: '0',
    },
    terms: [genre('fantasy', 'Fantasy'), artist('lin-wei', 'Lin Wei')],
  },
  {
    id: 104,
    authorId: 1,
    dateGmt: '2018-01-09 10:00:00',
    title: 'Deleted Draft Series',
    name: 'deleted-draft-series',
    content: '',
    status: 'trash',
    type: 'wp-manga',
    meta: {
      manga_unique_id: 'mu-trash-0004',
      _wp_manga_type: 'comic',
      _wp_manga_status: 'dropped',
    },
    terms: [],
  },
  {
    id: 105,
    authorId: 2,
    dateGmt: '2022-09-14 17:45:00',
    title: 'Saint of the Ninth Ward',
    name: 'saint-of-the-ninth-ward',
    content: '<p>A field medic is canonised by mistake.</p>',
    status: 'publish',
    type: 'wp-manga',
    meta: {
      manga_unique_id: 'mu-saint-0005',
      _wp_manga_type: 'webtoon',
      _wp_manga_status: 'weird-status',
      _wp_manga_alternative: '',
      _wp_manga_views: '54000',
      _manga_reviews: '77',
      _manga_avarage_reviews: '3.9',
      _thumbnail_id: '9005',
    },
    terms: [genre('drama', 'Drama'), tag('medical', 'Medical'), author('yoon-hae', 'Yoon Hae')],
  },
]

const pages = (chapterId: number, count: number): LegacyPage[] =>
  Array.from({ length: count }, (_, i) => ({
    idx: i + 1,
    path: `wp-content/uploads/manga/${chapterId}/${String(i + 1).padStart(2, '0')}.jpg`,
    attachmentId: null,
  }))

export const legacyChapters: LegacyChapter[] = [
  {
    chapterId: 5001,
    seriesPostId: 101,
    name: 'Chapter 12.5',
    slug: 'chapter-12-5',
    createdAt: '2021-05-02 10:00:00',
    pages: pages(5001, 18),
  },
  {
    chapterId: 5002,
    seriesPostId: 101,
    name: 'Ch.7 - The End',
    slug: 'ch-7-the-end',
    createdAt: '2021-04-01 10:00:00',
    pages: pages(5002, 22),
  },
  {
    chapterId: 5003,
    seriesPostId: 101,
    name: 'Vol.2 Ch.3',
    slug: 'vol-2-ch-3',
    createdAt: '2021-03-20 10:00:00',
    pages: pages(5003, 20),
  },
  {
    chapterId: 5004,
    seriesPostId: 101,
    name: 'Prologue',
    slug: 'prologue',
    createdAt: '2021-03-05 10:00:00',
    pages: pages(5004, 9),
  },
  {
    chapterId: 5005,
    seriesPostId: 102,
    name: '154',
    slug: 'chapter-154',
    createdAt: '2020-02-02 10:00:00',
    pages: pages(5005, 30),
  },
  {
    chapterId: 5006,
    seriesPostId: 102,
    name: 'Chapter 301: Title',
    slug: 'chapter-301',
    createdAt: '2020-06-06 10:00:00',
    pages: pages(5006, 27),
  },
  {
    chapterId: 5007,
    seriesPostId: 102,
    name: 'Chapter 1-2',
    slug: 'chapter-1-2',
    createdAt: '2019-12-01 10:00:00',
    pages: pages(5007, 12),
  },
  {
    chapterId: 5008,
    seriesPostId: 105,
    name: 'Chapter 007',
    slug: 'chapter-007',
    createdAt: '2022-10-01 10:00:00',
    pages: [],
  },
  {
    chapterId: 5009,
    seriesPostId: 105,
    name: 'Season 2 Finale',
    slug: 'season-2-finale',
    createdAt: '2022-12-24 10:00:00',
    pages: pages(5009, 40),
  },
  {
    chapterId: 5010,
    seriesPostId: 103,
    name: 'Chapter 1',
    slug: 'chapter-1',
    createdAt: '2023-06-02 10:00:00',
    pages: pages(5010, 15),
  },
]

export const legacyTerms: LegacyTerm[] = [
  { termId: 11, taxonomy: 'wp-manga-genre', slug: 'action', name: 'Action', count: 2 },
  { termId: 12, taxonomy: 'wp-manga-genre', slug: 'fantasy', name: 'Fantasy', count: 2 },
  { termId: 13, taxonomy: 'wp-manga-genre', slug: 'drama', name: 'Drama', count: 2 },
  { termId: 14, taxonomy: 'wp-manga-tag', slug: 'female-lead', name: 'Female Lead', count: 1 },
  { termId: 15, taxonomy: 'wp-manga-tag', slug: 'medical', name: 'Medical', count: 1 },
  { termId: 16, taxonomy: 'wp-manga-author', slug: 'yoon-hae', name: 'Yoon Hae', count: 2 },
  { termId: 17, taxonomy: 'wp-manga-author', slug: 'sato-rin', name: 'Sato Rin', count: 1 },
  { termId: 18, taxonomy: 'wp-manga-artist', slug: 'kim-doha', name: 'Kim Doha', count: 1 },
  { termId: 19, taxonomy: 'wp-manga-artist', slug: 'lin-wei', name: 'Lin Wei', count: 1 },
  { termId: 20, taxonomy: 'wp-manga-release', slug: '2021', name: '2021', count: 1 },
  { termId: 21, taxonomy: 'wp-manga-release', slug: '2019', name: '2019', count: 1 },
  { termId: 22, taxonomy: 'category', slug: 'uncategorised', name: 'Uncategorised', count: 3 },
]

export const legacyUsers: LegacyUser[] = [
  {
    id: 1,
    login: 'admin',
    email: 'ADMIN@old-site.test',
    displayName: 'Site Admin',
    registered: '2018-01-01 00:00:00',
    role: 'administrator',
  },
  {
    id: 2,
    login: 'Uploader One',
    email: 'uploader@old-site.test',
    displayName: 'Uploader One',
    registered: '2019-05-05 12:00:00',
    role: 'author',
  },
  {
    id: 3,
    login: 'reader_42',
    email: 'reader42@old-site.test',
    displayName: null,
    registered: '2022-08-08 08:08:08',
    role: 'subscriber',
  },
  {
    id: 4,
    login: 'møderator',
    email: 'mod@old-site.test',
    displayName: 'Moderator',
    registered: '2020-02-02 02:02:02',
    role: 'editor',
  },
]

export const legacyBookmarks: LegacyPost[] = [
  {
    id: 7001,
    authorId: 3,
    dateGmt: '2023-01-05 11:00:00',
    title: 'bookmark',
    name: 'bookmark-7001',
    content: '',
    status: 'publish',
    type: 'manga-bookmark',
    meta: {
      _bookmark_data: 'a:2:{s:7:"post_id";i:101;s:6:"status";s:7:"reading";}',
      _bookmark_time: '2023-01-05 11:00:00',
    },
    terms: [],
  },
  {
    id: 7002,
    authorId: 3,
    dateGmt: '2023-02-06 11:00:00',
    title: 'bookmark',
    name: 'bookmark-7002',
    content: '',
    status: 'publish',
    type: 'manga-bookmark',
    meta: {
      _bookmark_data: '{"post_id":102,"status":"completed"}',
      _bookmark_time: '2023-02-06 11:00:00',
    },
    terms: [],
  },
  {
    id: 7003,
    authorId: 4,
    dateGmt: '2023-03-07 11:00:00',
    title: 'bookmark',
    name: 'bookmark-7003',
    content: '',
    status: 'publish',
    type: 'manga-bookmark',
    // Points at a series that no longer exists — the dry run must count it as orphaned.
    meta: { _bookmark_data: 'a:1:{s:7:"post_id";i:999;}', _bookmark_time: '2023-03-07 11:00:00' },
    terms: [],
  },
]

export const legacyComments: LegacyComment[] = [
  {
    id: 8001,
    postId: 101,
    parentId: 0,
    userId: 3,
    authorName: 'reader_42',
    authorEmail: 'reader42@old-site.test',
    dateGmt: '2023-01-06 09:00:00',
    content: '<p>This chapter <strong>broke</strong> me.</p><p>Read it twice.</p>',
    approved: '1',
  },
  {
    id: 8002,
    postId: 101,
    parentId: 8001,
    userId: 4,
    authorName: 'Moderator',
    authorEmail: 'mod@old-site.test',
    dateGmt: '2023-01-06 10:30:00',
    content: 'Agreed &amp; seconded &#8212; see <a href="https://example.test/post">this</a>.',
    approved: '1',
  },
  {
    id: 8003,
    postId: 102,
    parentId: 0,
    userId: 0,
    authorName: 'guest',
    authorEmail: null,
    dateGmt: '2023-02-01 10:00:00',
    content: 'buy cheap stuff <a href="http://spam.test">here</a>',
    approved: 'spam',
  },
  {
    id: 8004,
    postId: 102,
    parentId: 0,
    userId: 3,
    authorName: 'reader_42',
    authorEmail: 'reader42@old-site.test',
    dateGmt: '2023-02-02 10:00:00',
    content: 'first line<br>second line',
    approved: '0',
  },
]

async function* iterate<T>(rows: readonly T[]): AsyncIterable<T> {
  for (const row of rows) yield row
}

export interface FixtureSourceOptions {
  name?: string
  chapterStorage?: 'custom-tables' | 'postmeta' | 'unknown'
}

/** An in-memory {@link LegacySource} over the dataset above. */
export const createFixtureSource = (options: FixtureSourceOptions = {}): LegacySource => ({
  name: options.name ?? 'Built-in sample dataset',
  listSeries: () => iterate(legacySeries),
  listChapters: (seriesPostId: number) =>
    iterate(legacyChapters.filter((c) => c.seriesPostId === seriesPostId)),
  listTerms: () => iterate(legacyTerms),
  listUsers: () => iterate(legacyUsers),
  listBookmarks: () => iterate(legacyBookmarks),
  listComments: () => iterate(legacyComments),
  readPage: async (page: LegacyPage): Promise<LegacyPageImage> => ({
    filename: page.path.split('/').pop() ?? 'page.jpg',
    bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    contentType: 'image/jpeg',
  }),
  chapterStorage: async () => options.chapterStorage ?? 'custom-tables',
})
