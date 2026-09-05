import { themeDraftSchema } from '@/components/admin/schemas-appearance'
import { scopeDiscardRoute, scopeDraftRoute } from '@/components/admin/server/appearance-routes'

/**
 * `PUT` saves the theme draft, `DELETE` throws it away (docs/15 "Preview": every change is a
 * draft until published).
 *
 * Both are the shared scope handlers now — the theme was the screen that had this workflow
 * first, and Brand, Menus and Copy joined it rather than growing a second one. See
 * `components/admin/server/appearance-routes.ts`.
 */
export const PUT = scopeDraftRoute('theme', themeDraftSchema)
export const DELETE = scopeDiscardRoute('theme')
