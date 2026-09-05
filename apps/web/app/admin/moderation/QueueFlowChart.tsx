/** biome-ignore-all lint/a11y/noNoninteractiveTabindex: the plot is a figure you can walk — arrow keys step through the days and show the same readout hovering does, which needs it focusable */
'use client'

import { fmt } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import type { QueueFlowPoint } from '@palscans/db'
import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react'
import {
  axisScale,
  groupDigits,
  labelIndexes,
  monthDay,
  nearestIndex,
} from '@/components/admin/analytics/chart'

/**
 * Reports opened against reports resolved, per day.
 *
 * Two series, so two hues and a legend — identity is never left to colour alone, and both
 * lines carry an end label as well. The pair (`--color-brand-hover` and
 * `--color-type-manhua`) was validated against the dataviz checks in both themes: ΔE 20.1
 * under deuteranopia, 28.3 under normal vision, and both clear 3:1 on the panel surface.
 * They are theme tokens rather than hexes, so an operator's own palette carries through.
 *
 * One axis, always: the two series are the same unit, so a second scale would only be a way
 * to make a growing queue look level.
 */

const HEIGHT = 210
const PADDING = { top: 16, right: 62, bottom: 26, left: 44 }
const DEFAULT_WIDTH = 880

const OPENED = 'var(--color-brand-hover)'
const RESOLVED = 'var(--color-type-manhua)'

export function QueueFlowChart({ points }: { points: QueueFlowPoint[] }) {
  const m = adminMessages.queueHealth
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

  const scale = axisScale(Math.max(...points.flatMap((p) => [p.opened, p.resolved])))
  const plotW = Math.max(1, width - PADDING.left - PADDING.right)
  const plotH = HEIGHT - PADDING.top - PADDING.bottom
  const step = points.length > 1 ? plotW / (points.length - 1) : 0
  const xs = points.map((_, i) => PADDING.left + i * step)
  const yOf = (v: number) => PADDING.top + plotH - (scale.max > 0 ? (v / scale.max) * plotH : 0)
  const path = (pick: (p: QueueFlowPoint) => number) =>
    points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${xs[i]?.toFixed(1)},${yOf(pick(p)).toFixed(1)}`)
      .join(' ')

  const ticks = labelIndexes(points.length)
  const last = points.length - 1
  const current = active === null ? null : (points[active] ?? null)
  const first = points[0] as QueueFlowPoint
  const lastPoint = points[last] as QueueFlowPoint

  const move = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    setActive(nearestIndex(xs, event.clientX - box.left))
  }
  const shift = (delta: number) =>
    setActive((i) => Math.min(points.length - 1, Math.max(0, (i ?? last) + delta)))
  const key = (event: KeyboardEvent<SVGSVGElement>) => {
    const handled: Record<string, () => void> = {
      ArrowRight: () => shift(1),
      ArrowLeft: () => shift(-1),
      Home: () => setActive(0),
      End: () => setActive(last),
      Escape: () => setActive(null),
    }
    const run = handled[event.key]
    if (!run) return
    event.preventDefault()
    run()
  }

  const aria = fmt(m.flowAria, { from: first.bucket, to: lastPoint.bucket })
  const tipX = current
    ? Math.min(Math.max(xs[active ?? last] ?? 0, 86), Math.max(86, width - 86))
    : 0

  return (
    <div ref={wrap} className="relative w-full">
      <ul className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-fg-muted">
        {[
          { label: m.opened, color: OPENED },
          { label: m.resolved, color: RESOLVED },
        ].map((s) => (
          <li key={s.label} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-0.5 w-4 rounded-full"
              style={{ background: s.color }}
            />
            {s.label}
          </li>
        ))}
      </ul>
      <svg
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img"
        tabIndex={0}
        aria-label={aria}
        className="block max-w-full touch-none"
        onPointerMove={move}
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        onKeyDown={key}
      >
        <title>{aria}</title>
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
              x={PADDING.left - 8}
              y={yOf(value) + 3.5}
              textAnchor="end"
              fill="var(--color-fg-subtle)"
              className="text-[10.5px] tabular-nums"
            >
              {value}
            </text>
          </g>
        ))}

        <path
          d={path((p) => p.opened)}
          fill="none"
          stroke={OPENED}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d={path((p) => p.resolved)}
          fill="none"
          stroke={RESOLVED}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {ticks.map((i) => (
          <text
            key={points[i]?.bucket}
            x={xs[i]}
            y={HEIGHT - 8}
            textAnchor={i === 0 ? 'start' : i === last ? 'end' : 'middle'}
            fill="var(--color-fg-subtle)"
            className="text-[10.5px] tabular-nums"
          >
            {monthDay(points[i]?.bucket ?? '')}
          </text>
        ))}

        {current ? (
          <line
            x1={xs[active ?? last]}
            x2={xs[active ?? last]}
            y1={PADDING.top}
            y2={HEIGHT - PADDING.bottom}
            stroke="var(--color-fg-subtle)"
            strokeWidth={1}
            shapeRendering="crispEdges"
          />
        ) : null}

        {/* End markers carry a surface ring so they stay legible where the two lines cross. */}
        {[
          { value: lastPoint.opened, color: OPENED, label: m.opened },
          { value: lastPoint.resolved, color: RESOLVED, label: m.resolved },
        ].map((s) => (
          <g key={s.label}>
            <circle
              cx={xs[last]}
              cy={yOf(s.value)}
              r={4}
              fill={s.color}
              stroke="var(--color-surface-1)"
              strokeWidth={2}
            />
            <text
              x={(xs[last] ?? 0) + 9}
              y={yOf(s.value) + 3.5}
              fill="var(--color-fg-muted)"
              className="text-[11px] tabular-nums"
            >
              {s.value}
            </text>
          </g>
        ))}
        {current
          ? [
              { value: current.opened, color: OPENED },
              { value: current.resolved, color: RESOLVED },
            ].map((s) => (
              <circle
                key={s.color}
                cx={xs[active ?? last]}
                cy={yOf(s.value)}
                r={5}
                fill={s.color}
                stroke="var(--color-surface-1)"
                strokeWidth={2}
              />
            ))
          : null}
      </svg>

      {current ? (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 shadow-2"
          style={{ left: tipX, top: 8 }}
        >
          <div className="text-[11.5px] leading-4 text-fg-muted tabular-nums">{current.bucket}</div>
          <div className="mt-0.5 flex gap-3 text-[13px] font-semibold tabular-nums">
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block h-0.5 w-3 rounded-full"
                style={{ background: OPENED }}
              />
              {groupDigits(current.opened)}
            </span>
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block h-0.5 w-3 rounded-full"
                style={{ background: RESOLVED }}
              />
              {groupDigits(current.resolved)}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  )
}
