import { cn } from './cn'

export interface AvatarProps {
  name: string
  src?: string | null
  size?: number
  className?: string
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? '?'
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase()
}

export function Avatar({ name, src, size = 32, className }: AvatarProps) {
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) }
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        style={style}
        className={cn('shrink-0 rounded-full bg-surface-2 object-cover', className)}
      />
    )
  }
  return (
    <span
      role="img"
      aria-label={name}
      style={style}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-brand-dim font-bold leading-none text-brand-ink',
        className,
      )}
    >
      {initials(name)}
    </span>
  )
}
