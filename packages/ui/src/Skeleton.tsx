import { cn } from './cn'

export interface SkeletonProps {
  className?: string
  /** Inline width/height when the final layout is a fixed box. */
  width?: number | string
  height?: number | string
  rounded?: 'sm' | 'md' | 'lg' | 'full'
}

const radius = { sm: 'rounded-sm', md: 'rounded-md', lg: 'rounded-lg', full: 'rounded-full' }

/** A placeholder that matches the final layout exactly. The pulse is off under reduced motion. */
export function Skeleton({ className, width, height, rounded = 'md' }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      style={{ width, height }}
      className={cn('bg-surface-2 motion-safe:animate-pulse', radius[rounded], className)}
    />
  )
}

export function SeriesCardSkeleton() {
  return (
    <div className="flex w-full flex-col gap-2">
      <Skeleton className="aspect-[2/3] w-full" />
      <Skeleton height={16} width="90%" />
      <Skeleton height={16} width="60%" />
    </div>
  )
}
