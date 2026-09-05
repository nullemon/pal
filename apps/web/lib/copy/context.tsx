'use client'

import { createContext, type ReactNode, useCallback, useContext } from 'react'

/**
 * The operator's copy overrides, for the handful of *client* components that render one.
 *
 * Most editable strings are read in server components, which call `siteCopy()` directly.
 * These five are not: the comment thread, the popular tabs, the end-of-chapter card, the
 * series action islands and the bookmark card all run in the browser, several levels below
 * a server boundary.
 *
 * This module imports nothing — not the registry, not `@palscans/core`, not `messages`.
 * That is the whole point. A client component reaching through `lib/copy/settings` for one
 * string would drag the settings module, `@palscans/db` and the resolver into the reader's
 * bundle, which is the shape of every regression docs/20 "What was in there" catalogues.
 * The caller passes its own fallback — the same `messages.x.y` it already reads — so the
 * catalogue is not duplicated here either.
 *
 * The value is *only the overrides*, not the resolved map: on a site with nothing configured
 * it serialises as `{}`, so the cost of this feature to a reader who has never had a string
 * changed is two bytes of RSC payload.
 */
export type CopyOverrideMap = Readonly<Record<string, string>>

const EMPTY: CopyOverrideMap = Object.freeze({})

const CopyContext = createContext<CopyOverrideMap>(EMPTY)

export function CopyProvider({ value, children }: { value: CopyOverrideMap; children: ReactNode }) {
  return <CopyContext.Provider value={value}>{children}</CopyContext.Provider>
}

/**
 * `const copy = useCopy()` then `copy('comments.empty', messages.comments.empty)`.
 *
 * The fallback is required, and it is the catalogue string the call site would otherwise
 * have rendered — so a component used outside the provider, or an id that has no override,
 * renders exactly what it rendered before.
 */
export function useCopy(): (id: string, fallback: string) => string {
  const overrides = useContext(CopyContext)
  return useCallback((id: string, fallback: string) => overrides[id] ?? fallback, [overrides])
}
