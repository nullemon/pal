import { describe, expect, it } from 'vitest'
import {
  anchorScroll,
  clampZoom,
  isZoomed,
  pinchTransform,
  pinchZoom,
  stepZoom,
  touchDistance,
  touchMidpoint,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEPS,
  zoomedWidth,
  zoomFromWheel,
  zoomLabel,
} from './zoom'

describe('clampZoom', () => {
  it('holds the range', () => {
    expect(clampZoom(0.2)).toBe(ZOOM_MIN)
    expect(clampZoom(99)).toBe(ZOOM_MAX)
    expect(clampZoom(2)).toBe(2)
  })

  it('rounds, because the value is persisted and comes from a pinch', () => {
    // A float ratio of two finger distances, stored verbatim, means `zoom === 1` is never
    // true again after a reader pinches back out — and that comparison is what re-enables
    // the tap zones.
    expect(clampZoom(1.0000000000001)).toBe(1)
    expect(clampZoom(2.33333333)).toBe(2.333)
  })

  it('survives a NaN from a degenerate gesture', () => {
    expect(clampZoom(Number.NaN)).toBe(ZOOM_MIN)
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(ZOOM_MIN)
  })
})

describe('isZoomed', () => {
  it('treats a hair above 1 as not zoomed', () => {
    // Panning, swipe-to-turn and the tap zones all hang off this. A pinch that ends at
    // 1.0004 must not leave the page-turn zones dead.
    expect(isZoomed(1)).toBe(false)
    expect(isZoomed(1.004)).toBe(false)
    expect(isZoomed(1.25)).toBe(true)
  })
})

describe('stepZoom', () => {
  it('walks the ladder in both directions', () => {
    expect(stepZoom(1, 1)).toBe(ZOOM_STEPS[1])
    expect(stepZoom(1.25, 1)).toBe(1.5)
    expect(stepZoom(1.5, -1)).toBe(1.25)
    expect(stepZoom(1, -1)).toBe(ZOOM_MIN)
    expect(stepZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX)
  })

  it('steps off a pinched value onto the ladder', () => {
    // The press after a pinch is the case a naive indexOf gets wrong: 1.73 is on no step,
    // and the reader expects the next notch up, not a jump back to the start.
    expect(stepZoom(1.73, 1)).toBe(2)
    expect(stepZoom(1.73, -1)).toBe(1.5)
  })

  it('is multiplicative, so every notch feels the same size', () => {
    const ratios = ZOOM_STEPS.slice(1).map((s, i) => s / (ZOOM_STEPS[i] as number))
    expect(Math.max(...ratios) / Math.min(...ratios)).toBeLessThan(1.6)
  })
})

describe('zoomFromWheel', () => {
  it('zooms in on a negative delta and out on a positive one', () => {
    expect(zoomFromWheel(1, -100)).toBeGreaterThan(1)
    expect(zoomFromWheel(2, 100)).toBeLessThan(2)
  })

  it('clamps a trackpad flick', () => {
    // deltaMode and trackpads disagree by orders of magnitude; one flick must not slam the
    // zoom to either end of the range.
    expect(zoomFromWheel(2, -4000)).toBeLessThanOrEqual(ZOOM_MAX)
    expect(zoomFromWheel(2, -4000)).toBe(zoomFromWheel(2, -50))
    expect(zoomFromWheel(2, 4000)).toBe(zoomFromWheel(2, 50))
  })

  it('changes by the same proportion at either end of the range', () => {
    const low = zoomFromWheel(1, -30) / 1
    const high = zoomFromWheel(3, -30) / 3
    expect(Math.abs(low - high)).toBeLessThan(0.001)
  })
})

describe('pinch geometry', () => {
  it('measures distance and midpoint', () => {
    expect(touchDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
    expect(touchMidpoint({ x: 0, y: 10 }, { x: 10, y: 20 })).toEqual({ x: 5, y: 15 })
  })

  it('never returns a zero distance to divide by', () => {
    expect(touchDistance({ x: 7, y: 7 }, { x: 7, y: 7 })).toBe(1)
  })

  it('scales from the zoom the gesture started at', () => {
    expect(pinchZoom(1, 100, 200)).toBe(2)
    expect(pinchZoom(2, 100, 50)).toBe(1)
    expect(pinchZoom(1, 100, 10_000)).toBe(ZOOM_MAX)
  })

  it('transforms relative to the committed zoom, anchored between the fingers', () => {
    // Already committed at 2× and pinching to 3× is a 1.5× transform, not a 3× one — the
    // column is already twice as wide.
    const t = pinchTransform(2, 3, { x: 40, y: 90 })
    expect(t.transform).toBe('scale(1.5000)')
    expect(t.transformOrigin).toBe('40px 90px')
  })
})

describe('anchorScroll', () => {
  /**
   * The assertion that matters: the content under the focal point does not move.
   *
   * Without it, zooming a long strip grows the chapter downward from its top, so the bubble
   * you zoomed in to read ends up several screens below — you lose your place as well as
   * your magnification, which is worse than having no zoom at all.
   */
  const contentUnder = (scroll: { left: number; top: number }, focal: number, zoom: number) =>
    (scroll.top + focal) / zoom

  it('keeps the point under the fingers under the fingers', () => {
    const before = { left: 0, top: 1000 }
    const focal = 300
    const after = anchorScroll(before, { x: 0, y: focal }, 1, 2)
    expect(contentUnder(after, focal, 2)).toBeCloseTo(contentUnder(before, focal, 1), 5)
  })

  it('works zooming back out too', () => {
    const before = { left: 0, top: 2600 }
    const focal = 300
    const after = anchorScroll(before, { x: 0, y: focal }, 2, 1)
    expect(contentUnder(after, focal, 1)).toBeCloseTo(contentUnder(before, focal, 2), 5)
  })

  it('anchors horizontally as well, for a zoomed page wider than the screen', () => {
    const after = anchorScroll({ left: 100, top: 0 }, { x: 200, y: 0 }, 1, 2)
    expect(after.left).toBe(400)
  })

  it('never scrolls to a negative offset', () => {
    expect(anchorScroll({ left: 0, top: 0 }, { x: 10, y: 10 }, 2, 1)).toEqual({ left: 0, top: 0 })
  })
})

describe('zoomedWidth', () => {
  it('is relative to the fit, so 2× means twice as big on either screen', () => {
    // The definition the team's two cases need: a phone and a desktop both get "twice what
    // I was looking at". An absolute target width would be a no-op on one and a leap on the
    // other.
    expect(zoomedWidth(1600, 820, 1)).toBe(820)
    expect(zoomedWidth(1600, 820, 2)).toBe(1640)
    expect(zoomedWidth(390, 820, 1)).toBe(390)
    expect(zoomedWidth(390, 820, 2)).toBe(780)
  })

  it('does not widen past the cap at 1×', () => {
    expect(zoomedWidth(3000, 820, 1)).toBe(820)
  })
})

describe('zoomLabel', () => {
  it('reads as a percentage', () => {
    expect(zoomLabel(1)).toBe('100%')
    expect(zoomLabel(1.5)).toBe('150%')
    expect(zoomLabel(2.5)).toBe('250%')
  })
})
