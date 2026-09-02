import { CommentsSection } from '@/components/comments/CommentsSection'
import { getAppUser } from '@/lib/comments/viewer'

/**
 * The chapter's comment thread (P2's island) under the end-of-chapter card. Kept in one
 * file so the integration agent can swap it if the comments API moves. Always drawn on
 * the site background so it reads on a sepia or white reader too.
 */
export async function ChapterComments({
  chapterId,
  enabled,
}: {
  chapterId: number
  enabled: boolean
}) {
  const user = await getAppUser()
  return (
    <div className="rounded-lg bg-bg p-4 text-fg md:p-6">
      <CommentsSection target={{ kind: 'chapter', id: chapterId }} user={user} enabled={enabled} />
    </div>
  )
}
