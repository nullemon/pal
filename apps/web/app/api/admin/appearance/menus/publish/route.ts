import { appearancePublishSchema } from '@/components/admin/schemas-appearance'
import { scopePublishRoute } from '@/components/admin/server/appearance-routes'

/**
 * `POST /api/admin/appearance/menus/publish { versionId? }` — make the menus draft live, or
 * restore an earlier version. Writes `settings.menus` and purges the `settings` tag every
 * shell component's cached read carries, so the header changes on the next request.
 */
export const POST = scopePublishRoute('menus', appearancePublishSchema)
