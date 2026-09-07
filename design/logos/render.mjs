#!/usr/bin/env node
/**
 * Regenerates every PNG in design/logos/sheets/ from the concept SVGs in this folder.
 *
 *   node design/logos/render.mjs
 *
 * Nothing is written outside design/logos/sheets/. `sharp` is resolved from the workspace
 * (it is already a dependency of apps/web); if the plain resolve fails we fall back to
 * scanning node_modules/.pnpm, which is where pnpm actually parks it.
 */
import { createRequire } from 'node:module'
import { readFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, 'sheets')
const require = createRequire(import.meta.url)

function loadSharp() {
  const tries = ['sharp']
  // walk up looking for a node_modules/.pnpm with a sharp@* entry
  let dir = HERE
  for (let i = 0; i < 8; i++) {
    const pnpm = join(dir, 'node_modules', '.pnpm')
    if (existsSync(pnpm)) {
      for (const entry of readdirSync(pnpm)) {
        if (entry.startsWith('sharp@')) tries.push(join(pnpm, entry, 'node_modules', 'sharp'))
      }
    }
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  for (const t of tries) {
    try {
      return require(t)
    } catch {}
  }
  throw new Error('could not resolve sharp - run `pnpm install` at the repo root first')
}
const sharp = loadSharp()

// ---------------------------------------------------------------------------- palette
const INK = '#100d17'
const SURFACE = '#181423'
const LINE = '#2c2540'
const FG = '#ece9f4'
const FG_DIM = '#b2aec4'
const BRAND = '#7c3aed'
const WHITE = '#ffffff'
const FONT = 'DejaVu Sans, Liberation Sans, Helvetica, Arial, sans-serif'

// ---------------------------------------------------------------------------- concepts
// `mask` is the ground the maskable/avatar tests sit on. `bleed` marks the concepts whose own
// container already fills the canvas, so the maskable render keeps them at 100%; every other
// mark is a free-standing glyph and gets scaled to the 80% safe zone before it is placed.
const CONCEPTS = [
  { file: '01-panel-cut.svg', name: 'Panel Cut', note: 'monogram', mask: BRAND, bleed: true },
  { file: '02-dog-ear.svg', name: 'Dog-Ear', note: 'page fold', mask: INK },
  { file: '03-twin-bookmark.svg', name: 'Twin Bookmark', note: 'bookmark', mask: INK },
  { file: '04-panel-grid.svg', name: 'Panel Grid', note: 'panel grid', mask: INK },
  { file: '05-speed-slash.svg', name: 'Speed Slash', note: 'speed lines', mask: BRAND, bleed: true },
  { file: '06-scan-pass.svg', name: 'Scan Pass', note: 'scan line', mask: INK, bleed: true },
  { file: '07-bracket-tag.svg', name: 'Bracket Tag', note: 'scanlation tag', mask: INK },
  { file: '08-balloon-pal.svg', name: 'Balloon Pal', note: 'mascot', mask: INK },
  { file: '09-stacked-wordmark.svg', name: 'Stacked Wordmark', note: 'wordmark only', mask: INK, wordmarkOnly: true },
  { file: '10-aperture.svg', name: 'Aperture', note: 'eye / badge', mask: INK },
  { file: '11-balloon-p.svg', name: 'Balloon P', note: 'monogram + balloon', mask: BRAND, bleed: true },
]

// ---------------------------------------------------------------------------- helpers
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Rasterise an SVG source string to `w` px wide (SVGs here are square, 512 natural). */
async function raster(svg, w, natural = 512) {
  return sharp(Buffer.from(svg), { density: Math.max(1, (72 * w) / natural) })
    .resize({ width: Math.round(w) })
    .png()
    .toBuffer()
}

/** Blow a small raster up with hard pixel edges so 16px artefacts are visible. */
async function zoom(buf, factor) {
  const { width } = await sharp(buf).metadata()
  return sharp(buf)
    .resize({ width: width * factor, kernel: 'nearest' })
    .png()
    .toBuffer()
}

const dataUri = (buf) => `data:image/png;base64,${buf.toString('base64')}`

function text(x, y, s, { size = 22, fill = FG, weight = 400, anchor = 'start', spacing = 0 } = {}) {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" letter-spacing="${spacing}">${esc(s)}</text>`
}

async function writeSheet(name, width, height, body) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`
  const out = join(OUT, name)
  await sharp(Buffer.from(svg), { density: 72 }).png({ compressionLevel: 9 }).toFile(out)
  return out
}

// ---------------------------------------------------------------------------- wordmark
const wordmarkSrc = readFileSync(join(HERE, 'wordmark.svg'), 'utf8')
const WM_W = 474
const WM_H = 69
const wordmarkIn = (colour) => wordmarkSrc.replace(/currentColor/g, colour)

/** Horizontal lockup: mark on the left, PALScans set to a cap height of 0.52x the mark. */
async function lockup(markSvg, colour, markPx, { wordmarkOnly = false } = {}) {
  const capPx = Math.round(markPx * 0.52)
  const wmW = Math.round((WM_W / WM_H) * capPx)
  const wm = await raster(wordmarkIn(colour), wmW, WM_W)
  if (wordmarkOnly) return { parts: [{ buf: wm, x: 0, y: 0, w: wmW, h: capPx }], w: wmW, h: capPx }
  const gap = Math.round(markPx * 0.24)
  const mark = await raster(markSvg, markPx)
  return {
    parts: [
      { buf: mark, x: 0, y: 0, w: markPx, h: markPx },
      { buf: wm, x: markPx + gap, y: Math.round((markPx - capPx) / 2), w: wmW, h: capPx },
    ],
    w: markPx + gap + wmW,
    h: markPx,
  }
}

const place = (p, ox, oy) =>
  p.parts
    .map((q) => `<image x="${ox + q.x}" y="${oy + q.y}" width="${q.w}" height="${q.h}" xlink:href="${dataUri(q.buf)}"/>`)
    .join('')

// ---------------------------------------------------------------------------- main
mkdirSync(OUT, { recursive: true })
const sources = CONCEPTS.map((c) => ({ ...c, svg: readFileSync(join(HERE, c.file), 'utf8') }))

// ------------------------------------------------------------------ contact sheet
{
  const COLS = 5
  const CELL_W = 320
  const CELL_H = 348
  const PAD = 56
  const TOP = 132
  const W = PAD * 2 + COLS * CELL_W
  const H = TOP + 2 * CELL_H + PAD
  let body = `<rect width="${W}" height="${H}" fill="${INK}"/>`
  body += text(PAD, 66, 'PALScans - ten logo directions', { size: 34, weight: 700 })
  body += text(PAD, 98, `on ${INK} - each mark shown at 192px with a 20px favicon sample`, {
    size: 20,
    fill: FG_DIM,
  })

  for (let i = 0; i < sources.length; i++) {
    const c = sources[i]
    const cx = PAD + (i % COLS) * CELL_W
    const cy = TOP + Math.floor(i / COLS) * CELL_H
    body += `<rect x="${cx + 8}" y="${cy}" width="${CELL_W - 16}" height="${CELL_H - 28}" rx="18" fill="${SURFACE}" stroke="${LINE}"/>`
    const big = await raster(c.svg, 192)
    body += `<image x="${cx + (CELL_W - 192) / 2}" y="${cy + 24}" width="192" height="192" xlink:href="${dataUri(big)}"/>`
    const tiny = await raster(c.svg, 20)
    body += `<image x="${cx + 30}" y="${cy + 250}" width="20" height="20" xlink:href="${dataUri(tiny)}"/>`
    body += text(cx + 62, cy + 258, `${String(i + 1).padStart(2, '0')}  ${c.name}`, { size: 21, weight: 700 })
    body += text(cx + 62, cy + 284, c.note, { size: 17, fill: FG_DIM })
  }
  console.log('wrote', await writeSheet('00-contact-sheet.png', W, H, body))
}

// ------------------------------------------------------------------ detail sheets
for (let i = 0; i < sources.length; i++) {
  const c = sources[i]
  const W = 1600
  const PANEL_H = 720
  const TOP = 108
  const GAP = 24
  const P1 = TOP
  const P2 = P1 + PANEL_H + GAP
  const P3 = P2 + PANEL_H + GAP
  const P3_H = 460
  const H = P3 + P3_H + 40

  let body = `<rect width="${W}" height="${H}" fill="${INK}"/>`
  body += text(40, 56, `${String(i + 1).padStart(2, '0')}  ${c.name}`, { size: 32, weight: 700 })
  body += text(40, 86, `${c.note} - ${c.file}`, { size: 19, fill: FG_DIM })

  // --- ground panels (dark, then white) -----------------------------------
  const grounds = [
    { y: P1, bg: INK, fg: FG, dim: FG_DIM, label: `dark  ${INK}` },
    { y: P2, bg: WHITE, fg: '#241f33', dim: '#6b6580', label: 'white  #ffffff' },
  ]
  for (const g of grounds) {
    body += `<rect x="40" y="${g.y}" width="${W - 80}" height="${PANEL_H}" rx="16" fill="${g.bg}" stroke="${LINE}"/>`
    body += text(64, g.y + 34, g.label, { size: 18, fill: g.dim, spacing: 1 })

    const big = await raster(c.svg, 512)
    body += `<image x="64" y="${g.y + 64}" width="512" height="512" xlink:href="${dataUri(big)}"/>`
    body += text(64 + 256, g.y + 606, '512 px', { size: 18, fill: g.dim, anchor: 'middle' })

    // 64px, true size + 4x hard-pixel zoom
    const s64 = await raster(c.svg, 64)
    const z64 = await zoom(s64, 4)
    body += text(620, g.y + 70, '64 px', { size: 18, fill: g.dim, spacing: 1 })
    body += `<image x="620" y="${g.y + 86}" width="64" height="64" xlink:href="${dataUri(s64)}"/>`
    body += `<image x="720" y="${g.y + 86}" width="256" height="256" xlink:href="${dataUri(z64)}"/>`
    body += text(720, g.y + 368, '4x, no smoothing', { size: 16, fill: g.dim })

    // 16px, true size + 16x hard-pixel zoom
    const s16 = await raster(c.svg, 16)
    const z16 = await zoom(s16, 16)
    body += text(620, g.y + 404, '16 px  (favicon)', { size: 18, fill: g.dim, spacing: 1 })
    body += `<image x="620" y="${g.y + 420}" width="16" height="16" xlink:href="${dataUri(s16)}"/>`
    body += `<image x="720" y="${g.y + 420}" width="256" height="256" xlink:href="${dataUri(z16)}"/>`
    body += text(720, g.y + 702, '16x, no smoothing', { size: 16, fill: g.dim })

    // lockup
    const lk = await lockup(c.svg, g.bg === WHITE ? BRAND : FG, 84, { wordmarkOnly: c.wordmarkOnly })
    body += text(1030, g.y + 70, 'lockup', { size: 18, fill: g.dim, spacing: 1 })
    body += place(lk, 1030, g.y + Math.round((PANEL_H - 84) / 2))
  }

  // --- avatar / maskable / lockup panel -----------------------------------
  body += `<rect x="40" y="${P3}" width="${W - 80}" height="${P3_H}" rx="16" fill="${SURFACE}" stroke="${LINE}"/>`
  body += text(64, P3 + 34, 'containers', { size: 18, fill: FG_DIM, spacing: 1 })

  // circular avatar on the mask ground
  const av = await raster(c.svg, 224)
  const avSmall = await raster(c.svg, 40)
  body += `<defs>
    <clipPath id="av-big"><circle cx="${64 + 112}" cy="${P3 + 90 + 112}" r="112"/></clipPath>
    <clipPath id="av-sm"><circle cx="${330}" cy="${P3 + 90 + 112}" r="20"/></clipPath>
  </defs>`
  body += `<circle cx="${64 + 112}" cy="${P3 + 90 + 112}" r="112" fill="${c.mask}"/>`
  body += `<image x="64" y="${P3 + 90}" width="224" height="224" xlink:href="${dataUri(av)}" clip-path="url(#av-big)"/>`
  body += `<circle cx="330" cy="${P3 + 90 + 112}" r="20" fill="${c.mask}"/>`
  body += `<image x="310" y="${P3 + 90 + 92}" width="40" height="40" xlink:href="${dataUri(avSmall)}" clip-path="url(#av-sm)"/>`
  body += text(64, P3 + 74, 'circular avatar  224 / 40', { size: 17, fill: FG_DIM })

  // maskable square: full-bleed ground + the mark, with the 80% safe zone drawn on top.
  // Free-standing marks are placed at 80% so nothing important can fall outside the circle.
  const mkScale = c.bleed ? 1 : 0.8
  const mkPx = Math.round(288 * mkScale)
  const mkOff = Math.round((288 - mkPx) / 2)
  const mk = await raster(c.svg, mkPx)
  body += text(430, P3 + 74, `maskable  (${c.bleed ? 'full bleed' : 'mark at 80%'})`, {
    size: 17,
    fill: FG_DIM,
  })
  body += `<rect x="430" y="${P3 + 90}" width="288" height="288" fill="${c.mask}"/>`
  body += `<image x="${430 + mkOff}" y="${P3 + 90 + mkOff}" width="${mkPx}" height="${mkPx}" xlink:href="${dataUri(mk)}"/>`
  body += `<circle cx="${430 + 144}" cy="${P3 + 90 + 144}" r="115.2" fill="none" stroke="#f5c451" stroke-width="2" stroke-dasharray="7 7" opacity="0.9"/>`
  body += `<rect x="${430 + 28.8}" y="${P3 + 90 + 28.8}" width="230.4" height="230.4" fill="none" stroke="#f5c451" stroke-width="2" stroke-dasharray="7 7" opacity="0.55"/>`

  // lockups, large
  const lkD = await lockup(c.svg, FG, 110, { wordmarkOnly: c.wordmarkOnly })
  body += text(770, P3 + 74, 'lockup', { size: 17, fill: FG_DIM })
  body += place(lkD, 770, P3 + 90)
  const lkL = await lockup(c.svg, BRAND, 110, { wordmarkOnly: c.wordmarkOnly })
  body += `<rect x="750" y="${P3 + 232}" width="${lkL.w + 40}" height="150" rx="12" fill="${WHITE}"/>`
  body += place(lkL, 770, P3 + 252)

  const name = c.file.replace(/\.svg$/, '.png')
  console.log('wrote', await writeSheet(name, W, H, body))
}

console.log(`\n${sources.length} concepts -> ${resolve(OUT)}`)
