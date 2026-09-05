import { ImageResponse } from 'next/og'
import { getStorage } from '@/lib/storage'
import {
  coverInitials,
  EYEBROW_BLOCK,
  fitTitle,
  measureText,
  normaliseTint,
  OG_HEIGHT,
  OG_LAYOUT,
  OG_TEXT_WIDTH,
  OG_WIDTH,
  type OgCardText,
} from './og-card'

/**
 * Drawing half of the share card (docs/12 §2). `ImageResponse` (satori + resvg) does the
 * type and the layout; `sharp` decodes and resizes the cover first.
 *
 * Why not compose the whole card in sharp: sharp draws SVG text through librsvg, which
 * needs fonts from the system fontconfig — and the production image (infra/Dockerfile) is
 * `node:22-alpine` with no fonts installed at all, so every label would come out blank.
 * `ImageResponse` carries its own font and its own rasteriser, so the card looks the same
 * on Alpine as it does here. sharp still does the part it is best at, which is turning
 * whatever the worker stored (AVIF, WebP, or the seed's SVGs) into pixels of the right size.
 */

const BG = '#100d17'
const BG_DEEP = '#0d0b13'
const FG = '#ece9f4'
const FG_MUTED = '#b7b1c8'
const BRAND = '#7c3aed'

const GOLD = '#f5c451'

/** `#7c3aed` → `rgba(124,58,237,0.35)`. Satori wants real rgba in gradients. */
export const withAlpha = (hex: string, alpha: number): string => {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  const n = Number.parseInt(full, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r},${g},${b},${alpha})`
}

/**
 * The cover as a data URI at the size the card draws it, or null when there is no cover,
 * the object is missing, or the bytes are not an image we can decode. Every one of those is
 * an ordinary case — the card falls back to a monogram panel rather than failing.
 */
export const loadCoverDataUri = async (key: string | null): Promise<string | null> => {
  if (!key) return null
  try {
    const storage = await getStorage()
    const bytes = await storage.get(key)
    if (!bytes || bytes.byteLength === 0) return null
    const { default: sharp } = await import('sharp')
    const out = await sharp(Buffer.from(bytes), { density: 150, failOn: 'none' })
      .resize(OG_LAYOUT.coverWidth * 1.5, OG_LAYOUT.coverHeight * 1.5, {
        fit: 'cover',
        position: 'top',
      })
      .jpeg({ quality: 78, mozjpeg: true })
      .toBuffer()
    return `data:image/jpeg;base64,${out.toString('base64')}`
  } catch {
    return null
  }
}

export interface OgCardInput extends OgCardText {
  coverDataUri: string | null
  /** The series' dominant cover colour, used to tint the card. */
  tint: string | null
  siteName: string
}

/**
 * Faux bold. Only one font face ships with `ImageResponse` (Geist Regular), and satori does
 * not synthesise weights — `fontWeight: 700` would render identically to body text. A thin
 * stroke in the fill colour thickens the strokes instead, which is what gives the title the
 * weight it needs to survive Discord's ~400px preview.
 */
const bold = (color: string, width: number) => ({
  color,
  WebkitTextStroke: `${width}px ${color}`,
})

const CoverPanel = ({
  coverDataUri,
  title,
  tint,
}: {
  coverDataUri: string | null
  title: string
  tint: string
}) => {
  const frame = {
    display: 'flex',
    width: OG_LAYOUT.coverWidth,
    height: OG_LAYOUT.coverHeight,
    borderRadius: 20,
    overflow: 'hidden',
    border: `1px solid ${withAlpha(FG, 0.14)}`,
    boxShadow: `0 24px 60px ${withAlpha('#000000', 0.55)}`,
  } as const
  if (coverDataUri) {
    return (
      <div style={frame}>
        {/* satori rasterises a raw <img>; next/image has no meaning inside an OG card. */}
        <img
          src={coverDataUri}
          width={OG_LAYOUT.coverWidth}
          height={OG_LAYOUT.coverHeight}
          alt=""
          style={{ objectFit: 'cover' }}
        />
      </div>
    )
  }
  const initials = coverInitials(title)
  return (
    <div
      style={{
        ...frame,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundImage: `linear-gradient(160deg, ${withAlpha(tint, 0.9)} 0%, ${BG_DEEP} 100%)`,
      }}
    >
      <div
        style={{
          display: 'flex',
          fontSize: 150,
          letterSpacing: -6,
          ...bold(withAlpha(FG, 0.82), 2),
        }}
      >
        {initials}
      </div>
    </div>
  )
}

/**
 * "301 chapters · ★ 9.6". The star is a path, not a character: Geist has no U+2605, and a
 * missing glyph rasterises as a tofu box that nothing in a unit test would catch.
 */
const MetaLine = ({ chapters, rating }: { chapters: string | null; rating: string | null }) => {
  if (!chapters && !rating) return null
  const text = { display: 'flex', fontSize: 25, color: FG_MUTED, letterSpacing: 0.2 } as const
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: 32, gap: 12 }}>
      {chapters ? <div style={text}>{chapters}</div> : null}
      {chapters && rating ? <div style={{ ...text, color: withAlpha(FG, 0.4) }}>·</div> : null}
      {rating ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <svg width="26" height="26" viewBox="0 0 24 24" role="img" aria-label="Rating">
            <path
              d="M12 2.6l2.9 5.88 6.49.95-4.7 4.58 1.11 6.46L12 17.42l-5.8 3.05 1.1-6.46-4.69-4.58 6.49-.95z"
              fill={GOLD}
            />
          </svg>
          <div style={{ ...text, color: FG }}>{rating}</div>
        </div>
      ) : null}
    </div>
  )
}

/** The 1200×630 card, as PNG bytes. */
export const renderOgCard = async (input: OgCardInput): Promise<Uint8Array> => {
  const tint = normaliseTint(input.tint) ?? BRAND
  const fitted = fitTitle(input.title, { hasChapter: !!input.chapter })
  // A key that is not the array index: a title repeated until it wraps produces genuinely
  // equal lines, so the offset the line starts at is what tells two of them apart.
  const titleLines: Array<{ key: string; line: string }> = []
  let titleOffset = 0
  for (const line of fitted.lines) {
    titleLines.push({ key: `${titleOffset}:${line}`, line })
    titleOffset += line.length
  }
  const chapterSize = 44
  const chapterWidth = input.chapter
    ? Math.min(OG_TEXT_WIDTH, measureText(input.chapter, chapterSize, 0.5) + 56)
    : 0

  const card = (
    <div
      style={{
        display: 'flex',
        width: OG_WIDTH,
        height: OG_HEIGHT,
        backgroundColor: BG,
        backgroundImage: [
          `radial-gradient(900px 700px at 8% 12%, ${withAlpha(tint, 0.42)} 0%, ${withAlpha(tint, 0)} 62%)`,
          `radial-gradient(700px 600px at 96% 100%, ${withAlpha(BRAND, 0.3)} 0%, ${withAlpha(BRAND, 0)} 70%)`,
          `linear-gradient(180deg, ${withAlpha(BG, 0)} 40%, ${withAlpha(BG_DEEP, 0.85)} 100%)`,
        ].join(', '),
      }}
    >
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          padding: OG_LAYOUT.pad,
          alignItems: 'center',
          gap: OG_LAYOUT.gutter,
        }}
      >
        <CoverPanel coverDataUri={input.coverDataUri} title={input.title} tint={tint} />

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            width: OG_TEXT_WIDTH,
            height: OG_LAYOUT.coverHeight,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                height: EYEBROW_BLOCK - 18,
                fontSize: 22,
                letterSpacing: 3.4,
                ...bold(withAlpha(FG, 0.66), 0.6),
              }}
            >
              {input.eyebrow.toUpperCase()}
            </div>

            {/* Each line gets the height `fitTitle` budgeted for it, so the block the
                fitting maths reserved is exactly the block the rasteriser lays out. */}
            <div style={{ display: 'flex', flexDirection: 'column', marginTop: 18 }}>
              {titleLines.map(({ key, line }) => (
                <div
                  key={key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    height: fitted.lineBox,
                    fontSize: fitted.fontSize,
                    letterSpacing: -1.5,
                    ...bold(FG, 1.35),
                  }}
                >
                  {line}
                </div>
              ))}
            </div>

            {input.chapter ? (
              <div
                style={{
                  display: 'flex',
                  marginTop: 26,
                  width: chapterWidth,
                  height: 74,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 14,
                  backgroundColor: BRAND,
                  boxShadow: `0 10px 30px ${withAlpha(BRAND, 0.45)}`,
                  fontSize: chapterSize,
                  letterSpacing: 0.5,
                  ...bold('#ffffff', 1.1),
                }}
              >
                {input.chapter}
              </div>
            ) : null}
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 20,
            }}
          >
            <MetaLine chapters={input.chapters} rating={input.rating} />
            <div style={{ display: 'flex', alignItems: 'center', height: 44, gap: 14 }}>
              <svg width="44" height="44" viewBox="0 0 28 28" role="img" aria-label="PALScans">
                <rect width="28" height="28" rx="7" fill={BRAND} />
                <path
                  d="M10 20V8h5a3.8 3.8 0 0 1 0 7.6h-5"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <div
                style={{
                  display: 'flex',
                  fontSize: 32,
                  letterSpacing: -0.8,
                  ...bold(FG, 1),
                }}
              >
                {input.siteName}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  const response = new ImageResponse(card, { width: OG_WIDTH, height: OG_HEIGHT })
  return new Uint8Array(await response.arrayBuffer())
}
