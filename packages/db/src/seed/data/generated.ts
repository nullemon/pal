/** Deterministic PRNG (mulberry32) so the seed is reproducible and therefore idempotent. */
export const rng = (seed: number) => {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1))
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)] as T
  const chance = (p: number) => next() < p
  const shuffle = <T>(arr: readonly T[]): T[] => {
    const out = [...arr]
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1))
      const tmp = out[i] as T
      out[i] = out[j] as T
      out[j] = tmp
    }
    return out
  }
  return { next, int, pick, chance, shuffle }
}
export type Rng = ReturnType<typeof rng>

const ADJ = [
  'Silent',
  'Crimson',
  'Hollow',
  'Iron',
  'Velvet',
  'Ashen',
  'Gilded',
  'Wandering',
  'Broken',
  'Eternal',
  'Paper',
  'Glass',
  'Thorned',
  'Midnight',
  'Ivory',
  'Rusted',
  'Starlit',
  'Nameless',
  'Quiet',
  'Burning',
  'Obsidian',
  'Pale',
  'Winter',
  'Copper',
  'Hidden',
  'Last',
  'Sleeping',
  'Golden',
  'Salt',
  'Ninefold',
]
const NOUN = [
  'Sovereign',
  'Archivist',
  'Blade',
  'Cartel',
  'Lantern',
  'Tower',
  'Warden',
  'Orchard',
  'Empress',
  'Alchemist',
  'Duelist',
  'Compass',
  'Choir',
  'Harbinger',
  'Ledger',
  'Menagerie',
  'Oracle',
  'Reliquary',
  'Sentinel',
  'Tidecaller',
  'Vagrant',
  'Marionette',
  'Foundry',
  'Gardener',
  'Executioner',
  'Librarian',
  'Skyline',
  'Pilgrim',
  'Chancellor',
  'Beekeeper',
]
const PLACE = [
  'the Hollow Court',
  'Nine Rivers',
  'the Salt Kingdom',
  'Ember Vale',
  'the Glass Sea',
  'Marrow Hill',
  'the Sunken Capital',
  'Lantern Street',
  'the Sixth Gate',
  'Greywater',
  'the Iron Coast',
  'Moonwell',
  'the Ashen Steppe',
  'Vesper City',
  'the Thousand Steps',
]
const PATTERNS: ((r: Rng) => string)[] = [
  (r) => `The ${r.pick(ADJ)} ${r.pick(NOUN)}`,
  (r) => `${r.pick(NOUN)} of ${r.pick(PLACE)}`,
  (r) => `Return of the ${r.pick(ADJ)} ${r.pick(NOUN)}`,
  (r) => `${r.pick(ADJ)} ${r.pick(NOUN)}`,
  (r) => `I Became the ${r.pick(ADJ)} ${r.pick(NOUN)}`,
  (r) => `The ${r.pick(NOUN)}'s ${r.pick(NOUN)}`,
  (r) => `${r.pick(NOUN)} Reborn`,
  (r) => `Chronicles of ${r.pick(PLACE)}`,
  (r) => `${r.pick(ADJ)} ${r.pick(NOUN)} Online`,
  (r) => `Regressor of ${r.pick(PLACE)}`,
  (r) => `The ${r.pick(ADJ)} Academy`,
  (r) => `${r.pick(NOUN)} Contract`,
]

/** Unique invented series titles — never real manga titles. */
export const generateTitles = (r: Rng, count: number, taken: Set<string>): string[] => {
  const out: string[] = []
  let guard = 0
  while (out.length < count && guard++ < count * 50) {
    const t = r.pick(PATTERNS)(r)
    const key = t.toLowerCase()
    if (taken.has(key)) continue
    taken.add(key)
    out.push(t)
  }
  return out
}

const KO_FAMILY = [
  'Kim',
  'Lee',
  'Park',
  'Choi',
  'Jung',
  'Kang',
  'Yoon',
  'Jang',
  'Lim',
  'Han',
  'Oh',
  'Seo',
]
const KO_GIVEN = [
  'Ji-ho',
  'Seo-yeon',
  'Min-jun',
  'Ha-eun',
  'Do-yun',
  'Su-bin',
  'Ye-jun',
  'Chae-won',
  'Si-woo',
  'Ji-an',
  'Tae-yang',
  'Yu-na',
]
const JA_FAMILY = [
  'Sato',
  'Suzuki',
  'Takahashi',
  'Tanaka',
  'Watanabe',
  'Ito',
  'Yamamoto',
  'Nakamura',
  'Kobayashi',
  'Kato',
]
const JA_GIVEN = ['Haruto', 'Yui', 'Sota', 'Aoi', 'Ren', 'Hina', 'Yuto', 'Mei', 'Riku', 'Sakura']
const ZH_FAMILY = ['Wang', 'Li', 'Zhang', 'Liu', 'Chen', 'Yang', 'Zhao', 'Huang', 'Zhou', 'Wu']
const ZH_GIVEN = ['Wei', 'Fang', 'Xiuying', 'Jun', 'Yan', 'Lei', 'Ming', 'Qing', 'Hao', 'Lan']
const STUDIOS = ['Studio', 'Works', 'Collective', 'Ink', 'Line', 'Atelier', 'Press']

export const personName = (r: Rng, type: string): string => {
  const [fam, giv] =
    type === 'manga'
      ? [JA_FAMILY, JA_GIVEN]
      : type === 'manhua'
        ? [ZH_FAMILY, ZH_GIVEN]
        : [KO_FAMILY, KO_GIVEN]
  return `${r.pick(fam)} ${r.pick(giv)}`
}
export const studioName = (r: Rng): string => `${r.pick(ADJ)} ${r.pick(STUDIOS)}`

export const READER_NAMES = [
  'frostbite',
  'kaelfan',
  'nightowl',
  'inkdrop',
  'chapterhound',
  'quietlurker',
  'saltfox',
  'redline',
  'mooncake',
  'tidewatcher',
  'glassbird',
  'paperknight',
  'embervale',
  'sleepless',
  'voidreader',
  'latenight',
  'copperwire',
  'stormcaller',
  'oldman_ha',
  'yeetmaster',
  'ninthblade',
  'ashenpage',
  'lanternlit',
  'greywater',
  'marrowhill',
  'sixthgate',
  'pilgrim99',
  'orchardkeeper',
  'skyline',
  'beekeeper',
]

export const COMMENT_TEXTS = [
  'The pacing this chapter was perfect. Finally some payoff for the setup arc.',
  'That last panel. I need the next chapter now.',
  'Art keeps getting better every chapter, the backgrounds are insane.',
  'Called it three chapters ago. The steward was never loyal.',
  'Thanks for the fast release!',
  'Is it just me or did the translation get smoother recently?',
  'This is the best fight choreography in any ongoing series right now.',
  'I love how the author lets quiet moments breathe.',
  'Weekly schedule and the quality is still this high? Respect.',
  'The regression twist actually makes sense this time.',
  'Finally caught up. What do I do with my life now.',
  'The side characters are carrying this arc honestly.',
  'Every chapter I think it peaked and then it does this.',
  'Anyone else rereading from chapter 1 after this reveal?',
  'The villain has a point and that is the scary part.',
  'Soundtrack in my head the whole chapter.',
  'This series deserves way more bookmarks.',
  'Cliffhanger again. Author, please, my heart.',
  'The world building detail in the margins is wild if you zoom in.',
  'New reader here, binged 80 chapters in two days. No regrets.',
  'That was a great chapter, but the previous arc was stronger imo.',
  'The typesetting on the sound effects this chapter is so clean.',
  'I did not expect to cry at a chapter about a ledger.',
  'Give the artist a vacation, this looks like it took a month.',
  'Big chapter. Big.',
]
export const REPLY_TEXTS = [
  'Agreed, completely.',
  'Same, I have been waiting for this since the academy arc.',
  'Nah, the previous arc was better.',
  'Check the raws, next chapter is even bigger.',
  'You are not alone, I reread it twice.',
  'This. Exactly this.',
  'Spoiler tag that please!',
  'Thanks, I missed that detail.',
]
export const SPOILER_TEXTS = [
  'the regent is his sister from the first timeline',
  'the map skill was never a skill, it was the dungeon reading him',
  'she dies in chapter 40 of the novel and it happens here too',
  'the ninth sword is the stable boy from the prologue',
]
