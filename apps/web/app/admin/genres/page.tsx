import { can } from '@palscans/core'
import { adminMessages } from '@palscans/core/messages/admin'
import { adminGenres, getDb } from '@palscans/db'
import { PageHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'
import { GenresScreen } from './GenresScreen'

/**
 * `Admin → Content → Genres` (migration 9028).
 *
 * The screen an operator reaches for when a genre is misspelled, duplicated, in the wrong
 * section or simply in the wrong order — all of which previously needed SQL against
 * production. Reading is `series.read`; editing is `series.update` (the same gate as the
 * series that carry these tags); retiring and merging are `series.delete`, because both
 * change what a public URL does and neither is undone by pressing Undo.
 */
export default async function GenresPage() {
  const user = await withPermission('series.read', { returnTo: '/admin/genres' })
  const rows = await adminGenres(await getDb())
  const m = adminMessages.genreAdmin
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <GenresScreen
        initial={rows.map((g) => ({
          id: g.id,
          slug: g.slug,
          name: g.name,
          kind: g.kind,
          position: g.position,
          seriesCount: g.seriesCount,
          publishedCount: g.publishedCount,
          retired: g.deletedAt !== null,
          mergedIntoName: g.mergedIntoName,
          mergedIntoSlug: g.mergedIntoSlug,
        }))}
        rights={{
          update: can(user, 'series.update'),
          remove: can(user, 'series.delete'),
        }}
      />
    </>
  )
}
