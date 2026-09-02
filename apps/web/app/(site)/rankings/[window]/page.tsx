import { messages } from '@palscans/core/messages'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cachedRankings } from '@/components/discovery/cached'
import { pageMetadata } from '@/components/discovery/metadata'
import {
  RANKING_WINDOWS,
  RankingsView,
  windowForSegment,
} from '@/components/discovery/RankingsView'

export const revalidate = 300
// Unknown windows fall through to notFound() below. Not `dynamicParams = false`: with that,
// Next 16 answers the on-demand re-render after a tag purge (settings / appearance) with an
// internal NoFallbackError, and /rankings/monthly serves a cached 404 until the next build.

const LIMIT = 50

export function generateStaticParams() {
  return RANKING_WINDOWS.filter((w) => w.segment).map((w) => ({ window: w.segment as string }))
}

export async function generateMetadata({
  params,
}: PageProps<'/rankings/[window]'>): Promise<Metadata> {
  const { window } = await params
  const key = windowForSegment(window)
  if (!key) return { title: messages.errors.notFound }
  const label = RANKING_WINDOWS.find((w) => w.key === key)?.label ?? ''
  return pageMetadata(
    'rankings',
    {},
    {
      path: `/rankings/${window}`,
      override: { title: `${messages.rankings.title} — ${label} · ${messages.site.name}` },
    },
  )
}

export default async function RankingsWindowPage({ params }: PageProps<'/rankings/[window]'>) {
  const { window } = await params
  const key = windowForSegment(window)
  if (!key) notFound()
  const items = await cachedRankings(key, LIMIT)
  return <RankingsView window={key} items={items} />
}
