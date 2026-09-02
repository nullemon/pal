import { chapters, getDb, series } from '@palscans/db'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { LayoutsScreen } from '@/components/admin/client/LayoutsScreen'
import { loadLayoutsSetting } from '@/components/admin/server/appearance'
import { withPermission } from '@/lib/auth'

export default async function LayoutsPage() {
  await withPermission('settings.write', { returnTo: '/admin/appearance/layouts' })
  const setting = await loadLayoutsSetting()
  const db = await getDb()
  const [sample] = await db
    .select({ slug: series.slug, number: chapters.number, title: series.title })
    .from(chapters)
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(
      and(
        eq(chapters.state, 'published'),
        isNull(chapters.deletedAt),
        eq(series.state, 'published'),
      ),
    )
    .orderBy(desc(chapters.publishedAt))
    .limit(1)
  return (
    <LayoutsScreen
      initial={setting}
      sample={sample ? { slug: sample.slug, number: sample.number, title: sample.title } : null}
    />
  )
}
