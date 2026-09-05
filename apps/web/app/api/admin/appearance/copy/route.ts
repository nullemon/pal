import { z } from 'zod'
import { copySettingSchema } from '@/components/admin/schemas-copy'
import { scopeDiscardRoute, scopeDraftRoute } from '@/components/admin/server/appearance-routes'

/**
 * `PUT /api/admin/appearance/copy` — Appearance → Copy and → Formatting (docs/15), saved as
 * a **draft**. `./publish` writes the two `settings` rows the public site reads.
 *
 * `copySettingSchema` still runs on the draft, not only on the publish: a string with an
 * unknown `{placeholder}` is refused with a message naming the field, so the operator finds
 * out while they are typing rather than discovering at publish time that a page quietly
 * ignored them. `normalizeCopyOverrides` (inside the scope adapter) then drops anything reset
 * to the shipped wording, which is what keeps a draft from growing into a second copy of the
 * catalogue.
 */
export const PUT = scopeDraftRoute('copy', z.object({ settings: copySettingSchema }))
export const DELETE = scopeDiscardRoute('copy')
