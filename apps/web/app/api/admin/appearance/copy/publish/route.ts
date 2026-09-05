import { appearancePublishSchema } from '@/components/admin/schemas-appearance'
import { scopePublishRoute } from '@/components/admin/server/appearance-routes'

/**
 * `POST /api/admin/appearance/copy/publish { versionId? }` — make the copy draft live, or
 * restore an earlier version. Writes `settings.copy` and `settings.formatting` together
 * (the screen edits them together) and purges the `settings` tag.
 */
export const POST = scopePublishRoute('copy', appearancePublishSchema)
