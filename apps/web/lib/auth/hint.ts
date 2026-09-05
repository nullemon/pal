/**
 * A deliberately non-secret marker that this browser has a session, written beside the
 * HttpOnly `sid` cookie by `setSessionCookie` and expiring with it.
 *
 * It exists for the announcement bar's audience (docs/15): the site shell is prerendered and
 * carries no per-reader state, so "show this only to members" has to be decided in the
 * browser, and `sid` is — correctly — unreadable there. The value is a literal `1`; it
 * confers nothing, authenticates nothing, and tells JavaScript only what the browser already
 * knows about itself. Everything that gates access still reads `sid` on the server.
 *
 * In its own module, with no imports, so the shell component that reads it in the browser and
 * the session layer that writes it on the server share one definition without the component
 * dragging the database in behind it.
 */
export const SIGNED_IN_HINT_COOKIE = 'pal_in'
