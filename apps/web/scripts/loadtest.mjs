#!/usr/bin/env node
/**
 * The reader-path load test (docs/10 phase 5, docs/20-performance.md).
 *
 * Measures the four requests a launch spike actually lands on the origin:
 *
 *   1. `/`                          the home page
 *   2. `/series/<slug>`             a series page
 *   3. `/series/<slug>/chapter-<n>` the reader
 *   4. `POST /api/views`            the beacon every reader fires 1.5 s later
 *
 * Page *images* are not in the list on purpose: they come from `cdn.palscans.org`, straight
 * out of R2, and never touch this server (docs/18 §1). What this measures is the whole of
 * what your box has to do.
 *
 *   pnpm --filter @palscans/web build
 *   pnpm --filter @palscans/web exec node scripts/loadtest.mjs --sweep
 *
 * **It runs `next start`, never `next dev`**, and refuses to start without a build. Dev-server
 * numbers are meaningless as a baseline — the dev server compiles on demand, skips the
 * production React build and disables the caches this test exists to measure — so if you
 * point `--url` at one, it stops rather than printing a number somebody will quote later.
 *
 * Plain Node, no dependencies. `node:http` rather than `fetch` so connection reuse and the
 * socket count are ours to control, and so timings do not carry undici's own queueing.
 *
 * Flags:
 *   --port N          port for the server it starts (default 3205)
 *   --url ORIGIN      measure a server you started yourself instead
 *   --concurrency N   in-flight requests per path (default 8)
 *   --duration S      measured seconds per path (default 10)
 *   --warmup N        unmeasured requests per path first (default 20)
 *   --series SLUG     pin the series instead of taking the first one on the home page
 *   --view-ips N      distinct reader addresses the beacon phase rotates through (default 256)
 *   --sweep           afterwards, re-run the reader at 1·2·4·8·16·32 concurrency to find the knee
 *   --json            machine-readable output on stdout
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const APP_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}
const has = (name) => args.includes(`--${name}`)

const PORT = Number(flag('port', 3205))
const EXTERNAL = flag('url', null)
const CONCURRENCY = Number(flag('concurrency', 8))
const DURATION_MS = Number(flag('duration', 10)) * 1000
const WARMUP = Number(flag('warmup', 20))
const PIN_SERIES = flag('series', null)
/**
 * How many distinct reader addresses the beacon phase rotates through. A launch spike is
 * thousands of *different* readers, so the accepted path is the one worth measuring — but
 * every accepted view is a real `view_events` row, so this is a knob rather than "one per
 * request". Past this count the requests exercise the per-viewer dedupe and the per-address
 * budget instead, which is the other half of the truth and is reported separately.
 */
const VIEW_IPS = Number(flag('view-ips', 256))
const SWEEP = has('sweep')
const JSON_OUT = has('json')

const ORIGIN = EXTERNAL ?? `http://127.0.0.1:${PORT}`
const { hostname: HOST, port: HTTP_PORT } = new URL(ORIGIN)

/** A real desktop UA: `isBotUserAgent` drops a view with a missing or crawler-looking one. */
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

const log = (...a) => {
  if (!JSON_OUT) console.log(...a)
}
const die = (msg) => {
  console.error(`loadtest: ${msg}`)
  process.exit(1)
}

// ---------------------------------------------------------------- http client

const agent = new http.Agent({
  keepAlive: true,
  maxSockets: CONCURRENCY,
  maxFreeSockets: CONCURRENCY,
})

/**
 * One request, timed end to end — the body is read to completion, not just the headers.
 * That distinction matters here: these pages stream, so time-to-first-byte can look
 * excellent while the reader is still waiting for the part with the chapter in it.
 */
const request = ({ method = 'GET', path: url, body = null, headers = {}, collect = false }) =>
  new Promise((resolve) => {
    const started = process.hrtime.bigint()
    const ms = () => Number(process.hrtime.bigint() - started) / 1e6
    const req = http.request(
      {
        host: HOST,
        port: HTTP_PORT,
        path: url,
        method,
        agent,
        headers: {
          'user-agent': UA,
          'accept-encoding': 'identity',
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          ...headers,
        },
      },
      (res) => {
        const ttfb = ms()
        let bytes = 0
        const chunks = []
        res.on('data', (c) => {
          bytes += c.length
          if (collect) chunks.push(c)
        })
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            ms: ms(),
            ttfb,
            bytes,
            body: collect ? Buffer.concat(chunks).toString('utf8') : '',
          }),
        )
      },
    )
    req.on('error', (err) =>
      resolve({ status: 0, ms: ms(), ttfb: ms(), bytes: 0, error: err.message }),
    )
    if (body !== null) req.write(body)
    req.end()
  })

// ---------------------------------------------------------------- the server

let server = null

const health = async () => {
  const res = await request({ path: '/api/health', collect: true }).catch(() => null)
  return res && res.status === 200 ? res.body : null
}

/**
 * Refuse a dev server. Its numbers are not a baseline, and the whole point of writing them
 * into docs/20 is that somebody will read them months from now and believe them.
 */
const assertProductionServer = async () => {
  const home = await request({ path: '/', collect: true })
  if (home.status !== 200) die(`GET / answered ${home.status}; expected 200`)
  const devMarkers = [
    '/_next/static/development/',
    '__nextjs_original-stack-frame',
    'next-devtools',
  ]
  const found = devMarkers.find((m) => home.body.includes(m))
  if (found)
    die(`that server looks like \`next dev\` (found ${found}). Build it and use next start.`)
  return home.body
}

const startServer = async () => {
  if (!existsSync(path.join(APP_DIR, '.next', 'BUILD_ID')))
    die('no production build found. Run `pnpm --filter @palscans/web build` first.')

  server = spawn('pnpm', ['exec', 'next', 'start', '-p', String(PORT)], {
    cwd: APP_DIR,
    stdio: JSON_OUT ? 'ignore' : ['ignore', 'ignore', 'inherit'],
    detached: true,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
      // The production guards in lib/env.ts are real: an explicit loopback SITE_URL is the
      // documented exemption for exactly this (a local `next start` verification run).
      SITE_URL: `http://127.0.0.1:${PORT}`,
      SESSION_SECRET: process.env.SESSION_SECRET ?? randomBytes(32).toString('base64'),
      INTERNAL_API_SECRET: process.env.INTERNAL_API_SECRET ?? randomBytes(32).toString('base64'),
      // Production requires a proxy mode, and it is also what makes the per-IP rate limit and
      // the per-viewer dedupe on /api/views real rather than one shared bucket.
      TRUSTED_PROXY: 'xff',
      TRUSTED_PROXY_HOPS: '1',
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://pal:pal@127.0.0.1:5433/palscans',
    },
  })

  for (let i = 0; i < 120 && !(await health()); i++) await sleep(500)
  if (!(await health())) die(`server never came up on ${ORIGIN}`)
}

const stopServer = () => {
  if (!server?.pid) return
  try {
    process.kill(-server.pid, 'SIGKILL')
  } catch {
    // already gone
  }
  server = null
}

// ---------------------------------------------------------------- discovery

/** First `/series/<slug>` on the home page — whatever this deployment actually features. */
const findSeries = (html) => {
  if (PIN_SERIES) return PIN_SERIES
  const m = html.match(/href="\/series\/([a-z0-9][a-z0-9-]*)"/i)
  return m?.[1] ?? null
}

/** First `chapter-<n>` link on the series page. */
const findChapter = (html, slug) => {
  const re = new RegExp(`href="/series/${slug}/(chapter-[0-9.]+)"`, 'i')
  return html.match(re)?.[1] ?? null
}

/**
 * `seriesId` / `chapterId` for the beacon, read out of the flight payload the page already
 * carries for `<ViewBeacon>` — the same numbers a real browser would post back.
 */
const findIds = (html) => {
  const num = (key) => {
    const m = html.match(new RegExp(`\\\\?"${key}\\\\?":(\\d+)`))
    return m ? Number(m[1]) : null
  }
  return { seriesId: num('seriesId'), chapterId: num('chapterId') }
}

// ---------------------------------------------------------------- measuring

const percentile = (sorted, p) => {
  if (sorted.length === 0) return 0
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]
}

/**
 * Closed-loop: `CONCURRENCY` virtual readers, each sending the next request as soon as the
 * last one finished, for `DURATION_MS`. Throughput is therefore "what this box does at this
 * concurrency", which is the number worth having — an open-loop generator would report a
 * rate the server never actually served.
 */
const measure = async (
  name,
  build,
  { concurrency = CONCURRENCY, durationMs = DURATION_MS } = {},
) => {
  for (let i = 0; i < WARMUP; i++) await request(build(0, i))

  const samples = []
  const ttfbs = []
  const statuses = new Map()
  const notes = new Map()
  const deadline = Date.now() + durationMs
  const startedAt = process.hrtime.bigint()

  const worker = async (vu) => {
    for (let n = 0; Date.now() < deadline; n++) {
      const spec = build(vu, n)
      const res = await request(spec)
      samples.push(res.ms)
      ttfbs.push(res.ttfb)
      statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1)
      const note = spec.note?.(res)
      if (note) notes.set(note, (notes.get(note) ?? 0) + 1)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, (_, vu) => worker(vu)))
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6

  const sorted = [...samples].sort((a, b) => a - b)
  const ttfbSorted = [...ttfbs].sort((a, b) => a - b)
  return {
    name,
    concurrency,
    requests: samples.length,
    seconds: elapsedMs / 1000,
    rps: samples.length / (elapsedMs / 1000),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.at(-1) ?? 0,
    ttfbP50: percentile(ttfbSorted, 50),
    statuses: Object.fromEntries([...statuses].sort((a, b) => b[1] - a[1])),
    notes: Object.fromEntries([...notes].sort((a, b) => b[1] - a[1])),
  }
}

const round = (n) => Math.round(n * 10) / 10

const table = (rows) => {
  const head = ['path', 'req', 'req/s', 'p50 ms', 'p95 ms', 'p99 ms', 'max ms', 'ttfb p50']
  const body = rows.map((r) => [
    r.name,
    String(r.requests),
    round(r.rps).toFixed(1),
    round(r.p50).toFixed(1),
    round(r.p95).toFixed(1),
    round(r.p99).toFixed(1),
    round(r.max).toFixed(1),
    round(r.ttfbP50).toFixed(1),
  ])
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)))
  const line = (cells) =>
    cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ')
  return [line(head), widths.map((w) => '-'.repeat(w)).join('  '), ...body.map(line)].join('\n')
}

// ---------------------------------------------------------------- run

const main = async () => {
  if (!EXTERNAL) await startServer()
  const home = await assertProductionServer()
  // Recorded with the results: on a box that is busy with something else, every latency here
  // is inflated and the throughput is not this application's ceiling. A baseline nobody can
  // tell apart from a noisy afternoon is not a baseline.
  const loadBefore = os.loadavg()

  const slug = findSeries(home)
  if (!slug) die('found no /series/<slug> link on the home page — is the catalogue empty?')
  const seriesPath = `/series/${slug}`

  const seriesHtml = (await request({ path: seriesPath, collect: true })).body
  const chapter = findChapter(seriesHtml, slug)
  if (!chapter) die(`found no chapter link on ${seriesPath}`)
  const chapterPath = `${seriesPath}/${chapter}`

  const chapterHtml = (await request({ path: chapterPath, collect: true })).body
  const ids = findIds(chapterHtml)
  if (!ids.seriesId) die(`could not read seriesId out of ${chapterPath}`)

  log(`server    ${ORIGIN}${EXTERNAL ? ' (yours)' : ' (next start, this script owns it)'}`)
  log(`targets   ${seriesPath} · ${chapterPath} · views ${ids.seriesId}/${ids.chapterId ?? 0}`)
  log(`load      ${CONCURRENCY} concurrent · ${DURATION_MS / 1000}s per path · ${WARMUP} warmup`)
  log('')

  const viewBody = JSON.stringify({ seriesId: ids.seriesId, chapterId: ids.chapterId ?? 0 })
  // A fresh /10 address per request until VIEW_IPS is used up, so the first requests take the
  // accepted path (Redis claim → in-process buffer → batched INSERT) rather than all landing
  // in one reader's dedupe slot.
  let viewSeq = 0
  const viewerAddress = () => {
    const i = viewSeq++ % Math.max(1, VIEW_IPS)
    return `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`
  }
  const views = () => ({
    method: 'POST',
    path: '/api/views',
    body: viewBody,
    collect: true,
    headers: {
      'content-type': 'application/json',
      origin: ORIGIN,
      'x-forwarded-for': viewerAddress(),
    },
    note: (res) => {
      try {
        return JSON.parse(res.body).data?.outcome ?? null
      } catch {
        return null
      }
    },
  })

  const rows = []
  rows.push(await measure('GET /', () => ({ path: '/' })))
  rows.push(await measure(`GET ${seriesPath}`, () => ({ path: seriesPath })))
  rows.push(await measure(`GET ${chapterPath}`, () => ({ path: chapterPath })))
  rows.push(await measure('POST /api/views', views))

  // Where the knee is: same request, rising concurrency. Throughput that stops climbing while
  // p95 climbs linearly is the box saturating, and the number of cores says what on.
  const sweep = []
  if (SWEEP) {
    for (const c of [1, 2, 4, 8, 16, 32]) {
      sweep.push(
        await measure(`reader @ ${c}`, () => ({ path: chapterPath }), {
          concurrency: c,
          durationMs: Math.max(5000, DURATION_MS / 2),
        }),
      )
    }
  }

  const machine = {
    node: process.version,
    cpu: os.cpus()[0]?.model ?? 'unknown',
    cores: os.cpus().length,
    memGb: Math.round(os.totalmem() / 1024 ** 3),
    platform: `${os.type()} ${os.release()}`,
    database: (process.env.DATABASE_URL ?? 'postgres://pal:pal@127.0.0.1:5433/palscans').replace(
      /\/\/[^@]*@/,
      '//***@',
    ),
    redis: process.env.REDIS_URL ? 'on' : 'off (in-process cache and dedupe)',
    concurrency: CONCURRENCY,
    durationSec: DURATION_MS / 1000,
    viewIps: VIEW_IPS,
    loadavgBefore: loadBefore.map((n) => Math.round(n * 100) / 100),
    loadavgAfter: os.loadavg().map((n) => Math.round(n * 100) / 100),
  }

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        { machine, targets: { seriesPath, chapterPath, ...ids }, rows, sweep },
        null,
        2,
      ),
    )
    return
  }
  console.log(table(rows))
  console.log('')
  if (sweep.length) {
    console.log(table(sweep))
    console.log('')
  }
  for (const r of rows) {
    const status = Object.entries(r.statuses)
      .map(([k, v]) => `${k}×${v}`)
      .join(' ')
    const note = Object.entries(r.notes)
      .map(([k, v]) => `${k}×${v}`)
      .join(' ')
    console.log(`${r.name.padEnd(40)} ${status}${note ? `  ·  ${note}` : ''}`)
  }
  console.log('')
  console.log(
    `machine   ${machine.cores}× ${machine.cpu}, ${machine.memGb} GB, node ${machine.node}`,
  )
  console.log(`db        ${machine.database}`)
  console.log(`redis     ${machine.redis}`)
  console.log(
    `loadavg   ${machine.loadavgBefore.join(' ')} before · ${machine.loadavgAfter.join(' ')} after` +
      ` (anything much above ${machine.cores} means the box was busy with something else)`,
  )
}

try {
  await main()
} finally {
  stopServer()
}
