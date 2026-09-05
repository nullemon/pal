import { adminMessages } from '@palscans/core/messages/admin'
import { z } from 'zod'
import { CommunityImages } from '@/components/admin/client/CommunityImages'
import { loadCommunityImages } from '@/components/admin/server/moderation'
import { parseSearch, type SearchParams } from '@/components/admin/server/params'
import { PageHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'
import { storageUrl } from '@/lib/storage'

const schema = z.object({ status: z.enum(['pending', 'approved']).catch('pending') })

export default async function CommunityImagesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  await withPermission('comment.moderate', { returnTo: '/admin/comments/images' })
  const p = parseSearch(schema, await searchParams)
  const rows = await loadCommunityImages(p.status)
  const m = adminMessages.admin.moderation.images
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <CommunityImages
        status={p.status}
        items={rows.map((r) => ({
          ...r,
          url: storageUrl(r.key),
          createdAt: r.createdAt.toISOString(),
        }))}
      />
    </>
  )
}
