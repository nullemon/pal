/**
 * Reader zoom: the arithmetic, kept pure so it can be tested without a browser.
 *
 * ## Why the reader needs its own zoom at all
 *
 * The browser's zoom cannot do this job here, and that is not a shortcoming of the browser.
 * The reader is a `position: fixed; inset: 0` overlay with the document pinned at
 * `overflow: hidden` (`Reader.tsx`), and the strip is one column capped at `820px`. Both of
 * those are measured against the *viewport*. Press Ctrl+ and the viewport shrinks in CSS
 * pixels by exactly the factor the page grows by, the overlay re-lays out to the new
 * viewport, the column is still 820 CSS pixels — and the artwork comes out the same physical
 * size it was. The zoom worked; it just had nothing to act on. On a phone the same fixed
 * overlay is what pinch-to-zoom fights: the visual viewport scales and the overlay
 * re-anchors to the layout viewport under it.
 *
 * So zoom has to be a property of the artwork rather than of the page, which has a second
 * benefit the browser's zoom could not give us: because it changes the *rendered width*, the
 * existing variant picker (`quality.ts`) asks for a wider encode as you zoom in. Browser zoom
 * upscales the pixels it already has and goes soft; this gets sharper. That is the difference
 * between "I zoomed and it's bigger and blurry" and actually being able to read small
 * lettering, which is what the zoom is for.
 *
 * ## Why these are layout widths and not a CSS transform
 *
 * A `transform: scale()` on the column is one compositor operation — cheap, and the right
 * tool *during* a pinch, where the alternative is reflowing every page on every frame. But
 * committed, it is the browser-zoom problem again: a scaled 1080px encode is a blurry
 * 2160px page. So the gesture scales (smooth) and the release commits to a width (sharp).
 * `pinchTransform` serves the first half, `clampZoom` and `anchorScroll` the second.
 */

export const ZOOM_MIN = 1
export const ZOOM_MAX = 4

/**
 * The steps the buttons and the +/− keys walk.
 *
 * Multiplicative rather than evenly spaced, because that is how zoom is perceived: 1 → 1.25
 * and 3 → 4 are both "one notch". An even ladder makes the first press feel enormous and the
 * last one feel like nothing happened.
 */
export const ZOOM_STEPS: readonly number[] = [1, 1.25, 1.5, 2, 2.5, 3, 4]

/** Below this, treat the zoom as off — the gate for tap zones, panning and swipe. */
export const ZOOM_EPSILON = 0.01

export const isZoomed = (zoom: number): boolean => zoom > ZOOM_MIN + ZOOM_EPSILON

/**
 * Into range, and onto three decimals.
 *
 * The rounding is not cosmetic. Zoom is persisted and it is driven by a pinch, so without it
 * the stored value is whatever a float ratio of two finger distances happened to be, and
 * `zoom === 1` — which decides whether the tap zones are live — is never quite true again
 * after a reader has pinched back out. `isZoomed` carries an epsilon for the same reason.
 */
export const clampZoom = (zoom: number): number => {
  if (!Number.isFinite(zoom)) return ZOOM_MIN
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom)) * 1000) / 1000
}

/** The next step up or down from wherever the zoom currently is, pinch included. */
export const stepZoom = (zoom: number, dir: 1 | -1): number => {
  const z = clampZoom(zoom)
  if (dir > 0) return clampZoom(ZOOM_STEPS.find((s) => s > z + ZOOM_EPSILON) ?? ZOOM_MAX)
  const under = ZOOM_STEPS.filter((s) => s < z - ZOOM_EPSILON)
  return clampZoom(under[under.length - 1] ?? ZOOM_MIN)
}

/**
 * Ctrl+wheel (and a trackpad pinch, which browsers report as exactly that).
 *
 * Proportional to the current zoom, so one wheel notch is the same *relative* change at 1×
 * and at 3×; a fixed increment crawls at the bottom of the range and lurches at the top.
 * `deltaY` is clamped before it is used because the three `deltaMode`s report wildly
 * different magnitudes for one notch and a trackpad can deliver a 300-unit flick.
 */
export const zoomFromWheel = (zoom: number, deltaY: number): number => {
  const d = Math.max(-50, Math.min(50, deltaY))
  return clampZoom(zoom * (1 - d / 300))
}

export interface Point {
  x: number
  y: number
}

export const touchDistance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y) || 1

export const touchMidpoint = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
})

/** Where a two-finger pinch has got to, from the zoom it started at. */
export const pinchZoom = (startZoom: number, startDistance: number, distance: number): number =>
  clampZoom(startZoom * (distance / Math.max(1, startDistance)))

/**
 * The live `transform` for a pinch in progress, relative to the committed zoom.
 *
 * Returns the scale the column should take *on top of* the width it already has, so the
 * gesture costs one compositor pass instead of a reflow per frame. Anchored at the midpoint
 * between the fingers so the artwork grows out from between them rather than from the corner.
 */
export const pinchTransform = (
  committedZoom: number,
  liveZoom: number,
  origin: Point,
): { transform: string; transformOrigin: string } => ({
  transform: `scale(${(liveZoom / Math.max(ZOOM_MIN, committedZoom)).toFixed(4)})`,
  transformOrigin: `${origin.x}px ${origin.y}px`,
})

export interface ScrollState {
  left: number
  top: number
}

/**
 * Where to scroll to so the point under the reader's fingers stays under them.
 *
 * Without this, zoom is almost useless on a long strip: you zoom to read a speech bubble and
 * the content grows downward from the top of the chapter, so the bubble you were looking at
 * is now several screens away and you have to go hunting for it. Zoom that moves what you are
 * looking at is worse than no zoom, because you lose your place as well.
 *
 * `focal` is in viewport coordinates relative to the scroll container — the pinch midpoint,
 * the cursor for Ctrl+wheel, or the centre of the screen for the buttons and keys.
 */
export const anchorScroll = (
  scroll: ScrollState,
  focal: Point,
  fromZoom: number,
  toZoom: number,
): ScrollState => {
  const k = clampZoom(toZoom) / Math.max(ZOOM_MIN, clampZoom(fromZoom))
  return {
    left: Math.max(0, (scroll.left + focal.x) * k - focal.x),
    top: Math.max(0, (scroll.top + focal.y) * k - focal.y),
  }
}

/**
 * The column width for a zoom level: the width it would have had, times the zoom.
 *
 * Zoom is relative to the fit, not absolute, which is the only definition that behaves the
 * same on both screens the team asked about: 2× is twice as big as whatever you were already
 * looking at, whether that was 820px of a desktop monitor or 390px of a phone. An absolute
 * "zoom to 1640px" would be a no-op on the desktop it was tuned for and a 4× jump on a phone.
 */
export const zoomedWidth = (available: number, maxColumn: number, zoom: number): number =>
  Math.round(Math.min(available, maxColumn) * clampZoom(zoom))

/** A zoom level as the control shows it: "100%", "150%", "250%". */
export const zoomLabel = (zoom: number): string => `${Math.round(clampZoom(zoom) * 100)}%`
