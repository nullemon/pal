/** biome-ignore-all lint/suspicious/noArrayIndexKey: decorative thumbnails, nothing is keyed by content */
import { cn } from '@palscans/ui'
import type { Direction } from '../schemas-appearance'

/**
 * The six 150×100 direction thumbnails from design/mockups/admin/AdminLayouts.dc.html,
 * drawn with token colours so they follow the theme.
 */
const Bar = ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
  <span className={cn('block', className)} style={style} />
)

function Header({ light }: { light?: boolean }) {
  return (
    <div
      className={cn(
        'flex h-1.5 items-center gap-[3px] rounded-[2px] px-[3px]',
        light
          ? 'bg-white shadow-[inset_0_0_0_1px_var(--color-preview-light-line-strong)]'
          : 'bg-surface-2',
      )}
    >
      <Bar className="h-[3px] w-2.5 rounded-[1px] bg-brand-hover opacity-80" />
      <Bar className={cn('h-0.5 w-2', light ? 'bg-preview-light-bar' : 'bg-surface-3')} />
      <Bar className={cn('h-0.5 w-2', light ? 'bg-preview-light-bar' : 'bg-surface-3')} />
      <Bar
        className={cn(
          'ml-auto h-[3px] w-3.5 rounded-[2px]',
          light ? 'bg-preview-light-bar' : 'bg-surface-3',
        )}
      />
    </div>
  )
}

function Cards({ n, light, cols }: { n: number; light?: boolean; cols: number }) {
  return (
    <div
      className="grid flex-1 gap-1"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: n }, (_, i) => (
        <span
          key={`c${i}`}
          className={cn(
            'rounded-[2px]',
            light
              ? 'bg-white shadow-[0_1px_2px_var(--color-preview-light-shadow),inset_0_0_0_1px_var(--color-preview-light-line)]'
              : 'bg-surface-3',
          )}
        />
      ))}
    </div>
  )
}

export function LayoutThumb({ direction }: { direction: Direction }) {
  switch (direction) {
    case 'A':
      return (
        <div className="flex h-[100px] w-[150px] flex-col gap-[5px] rounded-md bg-surface-1 p-2 shadow-[inset_0_0_0_1px_var(--color-glass-line)]">
          <Header />
          <div className="flex flex-1 gap-[5px]">
            <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
              <div className="relative h-[30px] rounded-[3px] bg-[linear-gradient(90deg,var(--color-surface-3),var(--color-surface-2))]">
                <div className="absolute inset-x-0 bottom-[3px] flex justify-center gap-0.5">
                  <Bar className="size-[3px] rounded-full bg-brand-hover" />
                  <Bar className="size-[3px] rounded-full bg-fg-subtle" />
                  <Bar className="size-[3px] rounded-full bg-fg-subtle" />
                </div>
              </div>
              <Cards n={4} cols={4} />
            </div>
            <div className="flex w-[30px] shrink-0 flex-col gap-[3px] rounded-[3px] bg-surface-2 p-1">
              <Bar className="h-[3px] bg-surface-3" />
              <Bar className="h-[3px] w-4/5 bg-surface-3" />
              <Bar className="h-[3px] bg-surface-3" />
              <Bar className="h-[3px] w-[70%] bg-surface-3" />
              <Bar className="flex-1 rounded-[2px] bg-surface-3" />
            </div>
          </div>
        </div>
      )
    case 'B':
      return (
        <div className="flex h-[100px] w-[150px] flex-col gap-[5px] rounded-md bg-surface-1 p-2 shadow-[inset_0_0_0_1px_var(--color-glass-line)]">
          <Header />
          <div className="flex flex-1 gap-[5px]">
            <div className="relative w-[62px] shrink-0 rounded-[4px] bg-[linear-gradient(160deg,var(--color-surface-3),var(--color-surface-2))] shadow-[inset_0_0_0_1px_var(--color-glass-line)]">
              <div className="absolute bottom-[5px] left-[5px] flex flex-col gap-0.5">
                <Bar className="h-1 w-[34px] rounded-[1px] bg-fg-subtle" />
                <Bar className="h-[3px] w-[22px] bg-fg-subtle/60" />
              </div>
            </div>
            <div className="grid min-w-0 flex-1 grid-cols-2 grid-rows-2 gap-1">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="flex flex-col gap-[3px] rounded-[3px] bg-surface-2 p-[3px] shadow-[inset_0_0_0_1px_var(--color-glass-line)]"
                >
                  <Bar className="flex-1 rounded-[2px] bg-surface-3" />
                  <Bar className="h-0.5 bg-surface-3" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )
    case 'C':
      return (
        <div className="flex h-[100px] w-[150px] gap-2 rounded-md bg-black p-2.5 shadow-[inset_0_0_0_1px_var(--color-glass-line)]">
          <div className="flex flex-1 flex-col justify-center gap-[5px]">
            <Bar className="h-[3px] w-[22px] bg-brand-hover opacity-85" />
            <Bar className="h-[9px] w-[74px] bg-fg-subtle" />
            <Bar className="h-[9px] w-[58px] bg-fg-subtle" />
            <Bar className="h-[9px] w-[42px] bg-fg-subtle" />
            <Bar className="mt-[3px] h-[3px] w-[70px] bg-surface-3" />
            <Bar className="h-[3px] w-[56px] bg-surface-3" />
          </div>
          <div className="h-[66px] w-11 shrink-0 self-center rounded-[2px] bg-[linear-gradient(180deg,var(--color-surface-3),var(--color-surface-2))] shadow-[inset_0_0_0_1px_var(--color-glass-line)]" />
        </div>
      )
    case 'D':
      return (
        <div className="flex h-[100px] w-[150px] flex-col gap-[5px] rounded-md bg-surface-1 p-2 shadow-[inset_0_0_0_1px_var(--color-glass-line)]">
          <Header />
          <div className="flex gap-[3px]">
            <Bar className="h-2 w-6 rounded-[4px] bg-brand/45" />
            <Bar className="h-2 w-[18px] rounded-[4px] bg-surface-3" />
            <Bar className="h-2 w-7 rounded-[4px] bg-surface-3" />
            <Bar className="h-2 w-4 rounded-[4px] bg-surface-3" />
            <Bar className="h-2 w-5 rounded-[4px] bg-surface-3" />
          </div>
          <Cards n={14} cols={7} />
        </div>
      )
    case 'E':
      return (
        <div className="flex h-[100px] w-[150px] flex-col gap-[5px] rounded-md bg-preview-light-bg p-2 shadow-[inset_0_0_0_1px_var(--color-glass-line)]">
          <Header light />
          <div className="flex flex-1 gap-[5px]">
            <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
              <div className="h-7 rounded-[4px] bg-white shadow-[0_1px_2px_var(--color-preview-light-shadow),inset_0_0_0_1px_var(--color-preview-light-line)]" />
              <Cards n={4} cols={4} light />
            </div>
            <div className="flex w-[30px] shrink-0 flex-col gap-[3px] rounded-[3px] bg-white p-1 shadow-[0_1px_2px_var(--color-preview-light-shadow),inset_0_0_0_1px_var(--color-preview-light-line)]">
              <Bar className="h-[3px] bg-preview-light-line-strong" />
              <Bar className="h-[3px] w-4/5 bg-preview-light-line-strong" />
              <Bar className="h-[3px] bg-preview-light-line-strong" />
              <Bar className="flex-1 rounded-[2px] bg-preview-light-bg" />
            </div>
          </div>
        </div>
      )
    default:
      return (
        <div className="flex h-[100px] w-[150px] flex-col gap-1.5 overflow-hidden rounded-md bg-bg-deep shadow-[inset_0_0_0_1px_var(--color-glass-line)]">
          <div className="relative h-11 bg-[linear-gradient(180deg,var(--color-surface-3)_0%,var(--color-surface-2)_60%,var(--color-bg-deep)_100%)]">
            <div className="absolute bottom-[5px] left-2 flex flex-col gap-[3px]">
              <Bar className="h-[5px] w-10 rounded-[1px] bg-fg-subtle" />
              <Bar className="h-[3px] w-[26px] bg-fg-subtle/60" />
            </div>
            <Bar className="absolute right-2 bottom-1.5 h-1.5 w-4 rounded-[3px] bg-brand-hover opacity-85" />
          </div>
          <div className="flex flex-col gap-1.5 px-2">
            {[0, 1].map((r) => (
              <div key={r} className="flex flex-col gap-[3px]">
                <Bar className="h-[3px] w-5 bg-fg-subtle/60" />
                <div className="flex gap-1 overflow-hidden">
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <Bar key={i} className="h-3.5 w-[22px] shrink-0 rounded-[2px] bg-surface-3" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )
  }
}
