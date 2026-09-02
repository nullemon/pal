/**
 * The staff sign-in's built-in path. Kept in its own module so the proxy can import it
 * without reaching `lib/auth/invites`, which touches the database.
 */
export const STAFF_PATH_DEFAULT = '/admin/login'
