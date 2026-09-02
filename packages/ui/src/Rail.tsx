import type { ReactNode } from 'react'
import { cn } from './cn'

export interface RailProps {
  children: ReactNode
  /** Accessible name for the scrolling region. */
  label?: string
  /** Width of each item (any CSS length). Defaults to 150px, 2:3 covers at rail height. */
  itemWidth?: string
  className?: string
}

/**
 * Horizontal scroll-snap row. No JavaScript: native momentum, keyboard scrolling and
 * accessibility come for free. Children are wrapped in snap-aligned list items.
 */
export function Rail({ children, label, itemWidth = '150px', className }: RailProps) {
  const items = Array.isArray(children) ? children : [children]
  return (
    <ul
      aria-label={label}
      style={{ '--rail-item': itemWidth } as React.CSSProperties}
      className={cn(
        'flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain scroll-smooth pb-2 [scrollbar-width:thin] [-webkit-overflow-scrolling:touch]',
        className,
      )}
    >
      {items.map((child, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static positional list, never reordered
        <li key={i} className="w-[var(--rail-item)] shrink-0 snap-start">
          {child}
        </li>
      ))}
    </ul>
  )
}
