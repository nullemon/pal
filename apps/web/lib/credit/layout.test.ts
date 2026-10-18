import { describe, expect, it } from 'vitest'
import {
  creditPlates,
  creditWindow,
  FONTS,
  fitSize,
  fontMetrics,
  LAYOUT,
  MIN_SIZE,
  wrapNote,
} from './layout'

/**
 * The credit card's measurements.
 *
 * Worth pinning because nothing downstream catches them being wrong: an SVG text node does
 * not clip, so a value sized too large simply prints over the artwork and the page still
 * renders, still returns 200, and still looks like a finished card to everything except a
 * reader. The faces differ by a third in width, so this is the layer where a font swap breaks.
 */

const NOTE =
  "I became friends with Yuki Yamada on Pokemon Go. I've been making more friends lately, which makes me happy."

describe('fitSize', () => {
  it('leaves a value that already fits at the size the layout asked for', () => {
    expect(fitSize('NaPal__', 262, 23, 0.77)).toBe(23)
  })

  it('shrinks a value that would run out of its box', () => {
    // The longest footer value the supplied card has to hold, in the widest face.
    const size = fitSize('palscans.org/discord', 254, 18, 0.77)
    expect(size).toBeLessThan(18)
    expect(size * 20 * 0.77).toBeLessThanOrEqual(254)
  })

  it('stops shrinking at a size that can still be read', () => {
    // A handle long enough that fitting it would mean illegible type: overhanging slightly
    // is the better failure, and the operator can see it and shorten the handle.
    expect(fitSize('x'.repeat(200), 254, 18, 0.77)).toBe(MIN_SIZE)
  })

  it('does not divide by an empty value', () => {
    expect(fitSize('   ', 254, 18, 0.77)).toBe(18)
    expect(fitSize('abc', 0, 18, 0.77)).toBe(18)
  })
})

describe('font metrics', () => {
  it('measures every face it offers', () => {
    for (const [id, font] of Object.entries(FONTS)) {
      expect(font.family, id).not.toBe('')
      // Sanity bounds: a face narrower than 0.4em or wider than 1em has been guessed, not
      // measured, and every wrap on the card is made of this number.
      expect(font.em, id).toBeGreaterThan(0.4)
      expect(font.em, id).toBeLessThan(1)
      expect(font.scale, id).toBeGreaterThan(0.5)
      expect(font.scale, id).toBeLessThanOrEqual(1)
    }
  })

  it('falls back to the one face the image cannot be missing', () => {
    // A settings row written by a build that offered a face this one has dropped.
    expect(fontMetrics('nope' as never)).toBe(FONTS.plain)
  })

  it('asks for a weight and a slant only from the face that has them', () => {
    expect(FONTS.plain.synthesise).toBe(true)
    expect(FONTS['anime-ace'].synthesise).toBe(false)
    expect(FONTS['vampire-wars'].synthesise).toBe(false)
  })
})

describe('wrapNote', () => {
  it('keeps every line inside the box it was measured for', () => {
    const lines = wrapNote(NOTE, 37, LAYOUT.note.maxLines)
    expect(lines.length).toBeLessThanOrEqual(LAYOUT.note.maxLines)
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(38)
  })

  it('wraps a comic face earlier than a text face, because it is wider', () => {
    const chars = (em: number) => Math.floor(300 / (16 * em))
    const comic = wrapNote(NOTE, chars(FONTS['anime-ace'].em), 8)
    const plain = wrapNote(NOTE, chars(FONTS.plain.em), 8)
    expect(comic.length).toBeGreaterThan(plain.length)
  })

  it('marks a note it had to cut rather than losing the end silently', () => {
    const lines = wrapNote(NOTE, 20, 2)
    expect(lines).toHaveLength(2)
    expect(lines[1]?.endsWith('…')).toBe(true)
  })

  it('leaves a note that fits unmarked', () => {
    expect(wrapNote('Thanks for reading.', 40, 4)).toEqual(['Thanks for reading.'])
  })

  it('draws nothing for an empty note', () => {
    expect(wrapNote('   ', 40, 4)).toEqual([])
  })
})

/**
 * The window the background is fitted to.
 *
 * Measured off the supplied overlay's alpha channel — the clear pixels flood-filled from the
 * middle of the card — so what is pinned here is that it stays on the artwork's left-hand
 * hole and never reaches the panels the text is drawn into. A background that crept under
 * the TEAM rows would put a photograph behind the handles.
 */
describe('creditWindow', () => {
  const W = 1448
  const H = 1086

  it('stays inside the canvas', () => {
    const win = creditWindow(W, H)
    expect(win.left).toBeGreaterThanOrEqual(0)
    expect(win.top).toBeGreaterThanOrEqual(0)
    expect(win.left + win.width).toBeLessThanOrEqual(W)
    expect(win.top + win.height).toBeLessThanOrEqual(H)
  })

  it('keeps clear of the panels the text goes in', () => {
    const win = creditWindow(W, H)
    // The handle boxes start here; the window must end well before them.
    expect(win.left + win.width).toBeLessThan(LAYOUT.rows.x * W)
    // And above the footer links, which run along the bottom of the card.
    expect(win.top + win.height).toBeLessThan(LAYOUT.links.discordY * H)
  })

  it('is most of the card, not a stamp in the corner', () => {
    const win = creditWindow(W, H)
    expect((win.width * win.height) / (W * H)).toBeGreaterThan(0.3)
  })

  it('survives an overlay too small to have a window', () => {
    // A replacement overlay may be any size, and `sharp` throws on a layer that hangs off
    // the canvas — which would take the whole card down rather than just the background.
    const win = creditWindow(1, 1)
    expect(win.width).toBeGreaterThan(0)
    expect(win.height).toBeGreaterThan(0)
    expect(win.left + win.width).toBeLessThanOrEqual(1)
    expect(win.top + win.height).toBeLessThanOrEqual(1)
  })
})

/**
 * The patches that cover the labels printed on the artwork.
 *
 * The renderer draws the role names itself, which only works because the printed ones are
 * painted out first. A patch in the wrong place is worse than no feature: it would put a
 * grey smear across the card, on every chapter, with nothing to say so.
 */
describe('creditPlates', () => {
  const W = 1448
  const H = 1086

  it('covers one plate per row the card is given', () => {
    expect(creditPlates(W, H, 4)).toHaveLength(4)
    expect(creditPlates(W, H, 6)).toHaveLength(6)
  })

  it('never covers more plates than the artwork has', () => {
    expect(creditPlates(W, H, 20)).toHaveLength(LAYOUT.rows.max)
  })

  it('stops short of the handle boxes', () => {
    // The plate breaks into the cream box in a brush edge; a straight patch across that
    // edge is the one way this is visible.
    for (const plate of creditPlates(W, H)) {
      expect(plate.patch.left + plate.patch.width).toBeLessThan(LAYOUT.rows.x * W)
    }
  })

  it('takes its texture from plate the printed name does not reach', () => {
    // The sample is read from the original artwork, so it may lie inside the area about to
    // be painted. What it must not contain is the printed label — sampling that is how a
    // patch ends up smearing a ghost of the old name across the new one.
    expect(LAYOUT.plates.sample.from).toBeGreaterThan(LAYOUT.plates.printed)
    // And it must stay on the plate, not run into the border below it.
    expect(LAYOUT.plates.sample.to).toBeLessThanOrEqual(LAYOUT.plates.patch.band)
    for (const plate of creditPlates(W, H)) {
      // Same columns, so the plate's left-to-right lighting lands where the artwork put it.
      expect(plate.sample.left).toBe(plate.patch.left)
      expect(plate.sample.width).toBe(plate.patch.width)
      expect(plate.sample.height).toBeGreaterThan(1)
    }
  })

  it('does not step outside the canvas', () => {
    for (const plate of creditPlates(W, H)) {
      expect(plate.patch.top).toBeGreaterThanOrEqual(0)
      expect(plate.patch.top + plate.patch.height).toBeLessThanOrEqual(H)
      expect(plate.patch.left + plate.patch.width).toBeLessThanOrEqual(W)
    }
  })

  it('gives up rather than returning a rect an overlay cannot hold', () => {
    // `sharp` throws on a composite that hangs off the canvas, and that would cost the
    // whole card rather than one label.
    expect(creditPlates(4, 4)).toEqual([])
  })

  it('does not overlap the row below it', () => {
    const plates = creditPlates(W, H)
    for (let i = 1; i < plates.length; i++) {
      const previous = plates[i - 1]
      const current = plates[i]
      if (!previous || !current) throw new Error('missing plate')
      expect(previous.patch.top + previous.patch.height).toBeLessThanOrEqual(current.patch.top + 1)
    }
  })
})
