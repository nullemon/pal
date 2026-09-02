/**
 * The 16 catalog series from design/mockups/BRIEF.md — exact titles, types, status,
 * ratings, latest chapter numbers and relative "updated" times.
 */
export interface CatalogSeed {
  n: number
  title: string
  type: 'manga' | 'manhwa' | 'manhua'
  status: 'ongoing' | 'completed' | 'hiatus'
  rating: number
  latest: number
  updated: string
  cover: string
  synopsis: string
  genres: string[]
  author: string
  artist: string
  year: number
  altTitles?: { title: string; lang?: string }[]
  ratingCount?: number
  bookmarks?: number
}

export const CATALOG: CatalogSeed[] = [
  {
    n: 1,
    title: 'Return of the Frost Monarch',
    type: 'manhwa',
    status: 'ongoing',
    rating: 9.6,
    latest: 301,
    updated: '12 min ago',
    cover: 'cover-01.svg',
    synopsis:
      'Executed by the empire he built, Kael Vantheris wakes three hundred years in the past with his memories intact and his power gone. The Frost Monarch has one winter to rebuild an army, and this time he remembers every betrayal.',
    genres: ['Action', 'Fantasy', 'Regression', 'Martial Arts', 'Revenge'],
    author: 'Han Seo-jin',
    artist: 'Studio Nocturne',
    year: 2023,
    altTitles: [
      { title: '서리 군주의 귀환', lang: 'ko' },
      { title: "Frost Monarch's Return", lang: 'en' },
    ],
    ratingCount: 12481,
    bookmarks: 81300,
  },
  {
    n: 2,
    title: 'Ashfall Regent',
    type: 'manhwa',
    status: 'ongoing',
    rating: 9.4,
    latest: 154,
    updated: '1 hour ago',
    cover: 'cover-02.svg',
    synopsis:
      'When the volcano that powers the capital goes quiet, a disgraced regent must bargain with the fire spirits her family enslaved — or watch the city freeze from the inside out.',
    genres: ['Fantasy', 'Drama', 'Royalty', 'Magic', 'Political'],
    author: 'Yoo Da-eun',
    artist: 'Yoo Da-eun',
    year: 2022,
    altTitles: [{ title: '재의 섭정', lang: 'ko' }],
  },
  {
    n: 3,
    title: 'Solo Cartographer',
    type: 'manhwa',
    status: 'ongoing',
    rating: 9.3,
    latest: 132,
    updated: '3 hours ago',
    cover: 'cover-03.svg',
    synopsis:
      'Every hunter needs a map, and only one man can draw them. Jung Ha-neul walks into dungeons nobody has cleared with a pen, a lantern and a skill that turns every corridor he sees into a weapon.',
    genres: ['Action', 'Fantasy', 'Dungeon', 'Hunter', 'System'],
    author: 'Park Min-jae',
    artist: 'Lumen Works',
    year: 2023,
    altTitles: [{ title: '나 혼자 지도를 그린다', lang: 'ko' }],
  },
  {
    n: 4,
    title: 'The Villainess Keeps the Receipts',
    type: 'manhwa',
    status: 'ongoing',
    rating: 9.2,
    latest: 96,
    updated: '5 hours ago',
    cover: 'cover-04.svg',
    synopsis:
      'Reborn as the villainess of a novel she edited, Seraphine Adler knows exactly which chapter she dies in. This time she is keeping a ledger of every slight, every debt and every lie — and the interest is due.',
    genres: ['Romance', 'Fantasy', 'Villainess', 'Transmigration', 'Comedy'],
    author: 'Lee Chae-rin',
    artist: 'Moon Ji-woo',
    year: 2024,
  },
  {
    n: 5,
    title: 'The Ninth Sword Saint',
    type: 'manhwa',
    status: 'ongoing',
    rating: 9.1,
    latest: 88,
    updated: '8 hours ago',
    cover: 'cover-05.svg',
    synopsis:
      'Eight sword saints have ruled the murim for a century. The ninth is a stable boy who learned to fight by watching, and the eight would very much like him to stop.',
    genres: ['Martial Arts', 'Action', 'Murim', 'Weak to Strong', 'Swords'],
    author: 'Kang Tae-ho',
    artist: 'Ink Ridge',
    year: 2024,
  },
  {
    n: 6,
    title: 'Overgrowth',
    type: 'manga',
    status: 'completed',
    rating: 9.0,
    latest: 120,
    updated: '1 day ago',
    cover: 'cover-06.svg',
    synopsis:
      'Ten years after the forests learned to walk, a botanist and a deserter cross a continent that grows back faster than it can be burned. A quiet, complete story about what survives.',
    genres: ['Sci-Fi', 'Drama', 'Post-Apocalyptic', 'Survival', 'Seinen'],
    author: 'Aoi Kurosawa',
    artist: 'Aoi Kurosawa',
    year: 2019,
    altTitles: [{ title: '過成長', lang: 'ja' }],
  },
  {
    n: 7,
    title: 'Dawnbreaker Guild',
    type: 'manhwa',
    status: 'ongoing',
    rating: 9.0,
    latest: 178,
    updated: '1 day ago',
    cover: 'cover-07.svg',
    synopsis:
      'The lowest-ranked guild in the capital has a healer who cannot heal, a tank who faints at blood and a leader who signed a contract she did not read. Somehow they keep clearing gates.',
    genres: ['Action', 'Comedy', 'Guild', 'Hunter', 'Fantasy'],
    author: 'Choi Eun-woo',
    artist: 'Choi Eun-woo',
    year: 2022,
  },
  {
    n: 8,
    title: 'Ironclad Heir',
    type: 'manhwa',
    status: 'ongoing',
    rating: 8.9,
    latest: 141,
    updated: '2 days ago',
    cover: 'cover-08.svg',
    synopsis:
      'The dukedom forges the empire’s armour, and its heir was born without the family gift. What he has instead is a workshop, a stubborn apprentice and a theory about steel nobody wants to hear.',
    genres: ['Fantasy', 'Drama', 'Royalty', 'Genius MC', 'Adventure'],
    author: 'Shin Ye-jin',
    artist: 'Forge Line Studio',
    year: 2023,
  },
  {
    n: 9,
    title: 'Gilded Dungeon Broker',
    type: 'manhwa',
    status: 'ongoing',
    rating: 8.9,
    latest: 67,
    updated: '2 days ago',
    cover: 'cover-09.svg',
    synopsis:
      'Nobody clears dungeons faster than the man who sells them. A former appraiser buys dying gates for scrap, flips them to desperate guilds and slowly realises what is actually growing inside.',
    genres: ['Fantasy', 'Dungeon', 'System', 'Thriller', 'Office'],
    author: 'Oh Ji-hoon',
    artist: 'Oh Ji-hoon',
    year: 2024,
  },
  {
    n: 10,
    title: 'Crown of Static',
    type: 'manhwa',
    status: 'ongoing',
    rating: 8.8,
    latest: 59,
    updated: '3 days ago',
    cover: 'cover-10.svg',
    synopsis:
      'In a city where the radio towers choose the king, a pirate broadcaster hears a frequency nobody else can — and it is asking for her by name.',
    genres: ['Sci-Fi', 'Mystery', 'Supernatural', 'Thriller', 'Psychological'],
    author: 'Baek Su-a',
    artist: 'Neon Tide',
    year: 2024,
  },
  {
    n: 11,
    title: 'Blood-Iron Academy',
    type: 'manhwa',
    status: 'ongoing',
    rating: 8.7,
    latest: 212,
    updated: '3 days ago',
    cover: 'cover-11.svg',
    synopsis:
      'The academy admits one commoner a decade and expects them to die by midterms. This year’s commoner has already died once, and he took notes.',
    genres: ['Action', 'Academy', 'Fantasy', 'Regression', 'School Life'],
    author: 'Jang Hyun-woo',
    artist: 'Redline Collective',
    year: 2021,
  },
  {
    n: 12,
    title: 'Whisper Engine',
    type: 'manga',
    status: 'completed',
    rating: 8.7,
    latest: 38,
    updated: '4 days ago',
    cover: 'cover-12.svg',
    synopsis:
      'A clockmaker builds a machine that repeats the last words spoken in a room. The town wants it destroyed. His daughter wants to hear her mother one more time.',
    genres: ['Drama', 'Mystery', 'Historical', 'Tragedy', 'Seinen'],
    author: 'Ren Takahashi',
    artist: 'Ren Takahashi',
    year: 2020,
    altTitles: [{ title: 'ささやきの機関', lang: 'ja' }],
  },
  {
    n: 13,
    title: 'Ten Thousand Year Apprentice',
    type: 'manhua',
    status: 'ongoing',
    rating: 8.6,
    latest: 402,
    updated: '5 days ago',
    cover: 'cover-13.svg',
    synopsis:
      'Sealed beneath a mountain for ten thousand years, the sect’s worst disciple emerges to find his masters long dead, his rivals ascended and his cultivation exactly where he left it: nowhere.',
    genres: ['Cultivation', 'Xianxia', 'Comedy', 'Action', 'Weak to Strong'],
    author: 'Lin Yuhan',
    artist: 'Jade Brush Studio',
    year: 2020,
    altTitles: [{ title: '万年学徒', lang: 'zh' }],
  },
  {
    n: 14,
    title: 'Lantern Fox Chronicles',
    type: 'manhua',
    status: 'ongoing',
    rating: 8.5,
    latest: 190,
    updated: '6 days ago',
    cover: 'cover-14.svg',
    synopsis:
      'A nine-tailed fox with eight tails to go takes a job carrying lanterns for the dead. Every soul she guides teaches her something about the one she lost.',
    genres: ['Supernatural', 'Fantasy', 'Drama', 'Historical', 'Gods'],
    author: 'Wei Xiaolan',
    artist: 'Wei Xiaolan',
    year: 2021,
  },
  {
    n: 15,
    title: 'Ruin Diver',
    type: 'manga',
    status: 'ongoing',
    rating: 8.4,
    latest: 73,
    updated: 'last week',
    cover: 'cover-15.svg',
    synopsis:
      'The old cities drowned, and the salvage crews that dive them are paid by the kilo. Mika dives deeper than anyone because she is looking for something that was never for sale.',
    genres: ['Adventure', 'Sci-Fi', 'Post-Apocalyptic', 'Survival', 'Shounen'],
    author: 'Sora Ishikawa',
    artist: 'Sora Ishikawa',
    year: 2022,
  },
  {
    n: 16,
    title: 'Saint of the Rusted Cathedral',
    type: 'manhua',
    status: 'hiatus',
    rating: 8.2,
    latest: 45,
    updated: '2 weeks ago',
    cover: 'cover-16.svg',
    synopsis:
      'A cathedral built from a fallen starship still grants miracles, and the boy who sweeps its floors is the only one who can hear the engine praying back.',
    genres: ['Fantasy', 'Sci-Fi', 'Mystery', 'Religion', 'Drama'],
    author: 'Zhao Mingyu',
    artist: 'Starfall Ink',
    year: 2023,
  },
]

/** Genres referenced above that are not in the common list get created as themes. */
export const EXTRA_GENRES: { name: string; kind: 'genre' | 'theme' }[] = [
  { name: 'Political', kind: 'theme' },
  { name: 'Religion', kind: 'theme' },
]
