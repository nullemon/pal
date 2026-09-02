import type { Metadata } from 'next'
import { cachedRankings } from '@/components/discovery/cached'
import { pageMetadata } from '@/components/discovery/metadata'
import { RankingsView } from '@/components/discovery/RankingsView'

export const revalidate = 300

const LIMIT = 50

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata('rankings', {}, { path: '/rankings' })
}

/** /rankings — this week. Monthly and all-time live at /rankings/[window] (ISR, 300s). */
export default async function RankingsPage() {
  const items = await cachedRankings('weekly', LIMIT)
  return <RankingsView window="weekly" items={items} />
}
