'use client'

import type { ReactNode } from 'react'
import { useMediaQuery } from '@/components/reader/hooks'

/**
 * Renders its children only while a media query matches — the difference between *hiding* a
 * placement and *not having* one.
 *
 * `hidden lg:block` around an ad slot looks like it does this job and does not. The element
 * is still in the document, so `AdTag` still mounts and still executes the network's script:
 * the slot is requested, an impression is counted, and nobody ever sees it because the box
 * is `display: none`. On a catalogue whose traffic is mostly phones, that is most of the
 * desktop inventory being spent on nothing. Networks measure viewability and price against
 * it, so the cost is not only the wasted impression — a slot that is never seen drags down
 * what the rest of them earn, and in the worst case gets an account looked at.
 *
 * Rendering nothing until the query matches means the slot is requested only where it is
 * visible. The server snapshot is `false`, so a wide-screen slot appears on hydration rather
 * than in the first paint: for an ad, which is client-side script in any case, that costs
 * nothing worth having, and the alternative is an impression that was never real.
 *
 * `className` is applied to the wrapper so the original layout classes keep working —
 * usually the very `hidden lg:block` this replaces, which is still wanted as the belt to
 * this braces if JS has not run yet.
 */
export function MediaOnly({
  query,
  className,
  children,
}: {
  query: string
  className?: string
  children: ReactNode
}) {
  const matches = useMediaQuery(query)
  if (!matches) return null
  if (!className) return children
  return <div className={className}>{children}</div>
}
