import { messages } from '@palscans/core/messages'
import { getDb, series } from '@palscans/db'
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { mediaUrl } from '@/lib/auth/media'
import styles from '../auth.module.css'

interface Cover {
  src: string
  alt: string
}

/** The 18 most-bookmarked published covers; the seed guarantees plenty. */
export async function loadCollageCovers(): Promise<Cover[]> {
  try {
    const db = await getDb()
    const rows = await db
      .select({ title: series.title, coverKey: series.coverKey })
      .from(series)
      .where(
        and(eq(series.state, 'published'), isNull(series.deletedAt), isNotNull(series.coverKey)),
      )
      .orderBy(desc(series.bookmarkCount), desc(series.id))
      .limit(18)
    return rows.flatMap((r) => (r.coverKey ? [{ src: mediaUrl(r.coverKey), alt: r.title }] : []))
  } catch {
    return []
  }
}

const COLUMN_DURATIONS = ['70s', '95s', '80s']

function Column({ covers, index }: { covers: Cover[]; index: number }) {
  // Each column loops over its slice twice so the -50% translate is seamless.
  const loop = [
    ...covers.map((c) => ({ ...c, pass: 'a' })),
    ...covers.map((c) => ({ ...c, pass: 'b' })),
  ]
  return (
    <div
      className={`${styles.column} ${index === 1 ? styles.columnReverse : ''} flex flex-col gap-4`}
      style={{ ['--drift-duration' as string]: COLUMN_DURATIONS[index % COLUMN_DURATIONS.length] }}
      aria-hidden="true"
    >
      {loop.map((c, i) => (
        <img
          key={`${c.src}-${c.pass}`}
          src={c.src}
          alt=""
          width={400}
          height={600}
          loading={i < 3 ? 'eager' : 'lazy'}
          decoding="async"
          className="aspect-[2/3] w-full rounded-lg object-cover shadow-2"
        />
      ))}
    </div>
  )
}

/** Desktop: three drifting columns behind a violet wash. Mobile: a single static strip. */
export function Collage({ covers }: { covers: Cover[] }) {
  if (covers.length === 0) return null
  const columns = [0, 1, 2].map((i) => covers.filter((_, idx) => idx % 3 === i))
  return (
    <div
      role="img"
      aria-label={messages.authPage.collageAlt}
      className="relative h-full min-h-40 w-full overflow-hidden bg-bg-deep"
    >
      <div
        className="absolute inset-0 hidden grid-cols-3 gap-4 px-6 lg:grid"
        style={{ top: '-10%' }}
      >
        {columns.map((col, i) => (
          <Column key={COLUMN_DURATIONS[i]} covers={col} index={i} />
        ))}
      </div>
      <div
        className="flex h-40 items-center gap-3 overflow-hidden px-4 lg:hidden"
        aria-hidden="true"
      >
        {covers.slice(0, 8).map((c, i) => (
          <img
            key={c.src}
            src={c.src}
            alt=""
            width={400}
            height={600}
            loading={i < 4 ? 'eager' : 'lazy'}
            decoding="async"
            className="aspect-[2/3] w-[88px] shrink-0 rounded-md object-cover shadow-2"
            style={{
              transform: `translateY(${i % 2 === 0 ? '-12px' : '12px'}) rotate(${i % 2 === 0 ? '-3deg' : '3deg'})`,
            }}
          />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-bg/80 via-brand/15 to-bg lg:bg-gradient-to-r lg:from-bg lg:via-bg/40 lg:to-bg/70" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 hidden p-10 lg:block">
        <p className="font-display text-3xl font-extrabold uppercase leading-none tracking-[-0.02em] text-fg">
          {messages.site.name}
        </p>
        <p className="mt-2 max-w-[36ch] text-sm text-fg-muted">{messages.site.tagline}</p>
      </div>
    </div>
  )
}
