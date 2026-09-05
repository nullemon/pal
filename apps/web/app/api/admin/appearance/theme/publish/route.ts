import { appearancePublishSchema } from '@/components/admin/schemas-appearance'
import { scopePublishRoute } from '@/components/admin/server/appearance-routes'

/**
 * `POST /api/admin/appearance/theme/publish { versionId? }` — publish the draft, or revert to
 * an earlier version (a copy of it becomes the new published row so history stays linear).
 * Archives the previous published row, purges the `appearance` cache tag, audits.
 */
export const POST = scopePublishRoute('theme', appearancePublishSchema)
