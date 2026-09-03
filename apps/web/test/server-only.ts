/**
 * Stand-in for the `server-only` package under vitest.
 *
 * Next resolves that specifier itself (to a module that throws when a client bundle pulls it
 * in); outside Next there is nothing to resolve, so importing any `server-only` module from a
 * unit test fails at import time. A unit test *is* the server, so the honest stub is nothing
 * at all — see the alias in `vitest.config.ts`.
 */
export {}
