/** biome-ignore-all lint/a11y/noNoninteractiveTabindex: the plot is a figure you can walk — arrow keys step through the days and show the same readout hovering does, which needs it focusable */
'use client'

import { fmt } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react'
import {
  axisScale,
  type ChartPoint,
  compactCount,
  groupDigits,
  labelIndexes,
  monthDay,
  nearestIndex,
  plotPoints,
} from './chart'

/**
 * Site-wide views per day: one series, so one hue — the brand accent for the line and the
 * same hue at 10% for the wash under it. Both are theme tokens, so the chart follows the
 * panel into light mode instead of carrying its own palette.
 *
 * The hover layer is part of the chart, not an extra: a crosshair snaps to the nearest day
 * and the readout leads with the number. Everything it shows is also in the table under the
 * chart, so no value is gated behind a pointer — arrow keys walk the same points for anyone
 * who cannot hover at all.
 */

const HEIGHT = 236
const PADDING = { top: 14, right: 18, bottom: 26, left: 54 }
/** Only until the ResizeObserver reports the real width; also what SSR renders at. */
const DEFAULT_WIDTH = 880

export function ViewsChart({ points }: { points: ChartPoint[] }) {
  const m = adminMessages.admin.analytics
  const wrap = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [active, setActive] = useState<number | null>(null)

  useEffect(() => {
    const el = wrap.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0
      if (next > 0) setWidth(Math.round(next))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  if (points.length === 0) return null

  const scale = axisScale(Math.max(...points.map((p) => p.views)))
  const laid = plotPoints(points, scale.max, { width, height: HEIGHT, padding: PADDING })
  const xs = laid.map((p) => p.x)
  const baseline = HEIGHT - PADDING.bottom
  const yOf = (value: number) =>
    baseline - (value / scale.max) * (HEIGHT - PADDING.top - PADDING.bottom)
  const line = laid.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
  const first = laid[0] as (typeof laid)[number]
  const last = laid[laid.length - 1] as (typeof laid)[number]
  const area = `${line.join(' ')} L${last.x.toFixed(1)},${baseline} L${first.x.toFixed(1)},${baseline} Z`
  const ticks = labelIndexes(points.length)
  const current = active === null ? null : (laid[active] ?? null)

  const move = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    setActive(nearestIndex(xs, event.clientX - box.left))
  }

  const step = (delta: number) =>
    setActive((i) => Math.min(points.length - 1, Math.max(0, (i ?? points.length - 1) + delta)))

  const key = (event: KeyboardEvent<SVGSVGElement>) => {
    const handled: Record<string, () => void> = {
      ArrowRight: () => step(1),
      ArrowLeft: () => step(-1),
      Home: () => setActive(0),
      End: () => setActive(points.length - 1),
      Escape: () => setActive(null),
    }
    const run = handled[event.key]
    if (!run) return
    event.preventDefault()
    run()
  }

  // Keep the readout inside the panel at both ends instead of letting it hang off the edge.
  const tipX = current ? Math.min(Math.max(current.x, 78), Math.max(78, width - 78)) : 0

  return (
    <div ref={wrap} className="relative w-full">
      <svg
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img"
        tabIndex={0}
        aria-label={fmt(m.chartAria, {
          from: first.point.bucket,
          to: last.point.bucket,
        })}
        className="block max-w-full touch-none rounded-md"
        onPointerMove={move}
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        onKeyDown={key}
      >
        <title>{fmt(m.chartAria, { from: first.point.bucket, to: last.point.bucket })}</title>
        {scale.ticks.map((value) => (
          <g key={value}>
            <line
              x1={PADDING.left}
              x2={width - PADDING.right}
              y1={yOf(value)}
              y2={yOf(value)}
              stroke="var(--color-line-soft)"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            <text
              x={PADDING.left - 10}
              y={yOf(value) + 3.5}
              textAnchor="end"
              fill="var(--color-fg-subtle)"
              className="text-[10.5px] tabular-nums"
            >
              {compactCount(value)}
            </text>
          </g>
        ))}

        <path d={area} fill="var(--color-brand-hover)" fillOpacity={0.1} />
        <path
          d={line.join(' ')}
          fill="none"
          stroke="var(--color-brand-hover)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {ticks.map((i) => (
          <text
            key={points[i]?.bucket}
            x={xs[i]}
            y={HEIGHT - 8}
            textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
            fill="var(--color-fg-subtle)"
            className="text-[10.5px] tabular-nums"
          >
            {monthDay(points[i]?.bucket ?? '')}
          </text>
        ))}

        {current ? (
          <line
            x1={current.x}
            x2={current.x}
            y1={PADDING.top}
            y2={baseline}
            stroke="var(--color-fg-subtle)"
            strokeWidth={1}
            shapeRendering="crispEdges"
          />
        ) : null}

        {/* The last point is the one the reader looks for, so it keeps a marker of its own. */}
        <circle
          cx={last.x}
          cy={last.y}
          r={4}
          fill="var(--color-brand-hover)"
          stroke="var(--color-surface-1)"
          strokeWidth={2}
        />
        {current ? (
          <circle
            cx={current.x}
            cy={current.y}
            r={5}
            fill="var(--color-brand-hover)"
            stroke="var(--color-surface-1)"
            strokeWidth={2}
          />
        ) : null}
      </svg>

      {current ? (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-line bg-surface-2 px-2.5 py-1.5 shadow-2"
          style={{ left: tipX, top: Math.max(28, current.y - 12) }}
        >
          <div className="font-body text-[15px] font-bold leading-5 text-fg">
            {groupDigits(current.point.views)}
          </div>
          <div className="text-[11.5px] leading-4 text-fg-muted tabular-nums">
            {current.point.bucket}
          </div>
        </div>
      ) : null}
    </div>
  )
}
