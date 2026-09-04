#!/usr/bin/env node
/**
 * Proves offline downloads actually work with no server (docs/06 "Progress and offline",
 * docs/17 §G).
 *
 * This exists because the Playwright spec cannot prove it. With a service worker in control,
 * `context.setOffline()`, `context.route()` and page-scoped CDP network emulation all leave
 * the worker's own passthrough `fetch` reaching the network, so a test that appears to pass
 * offline is really talking to a live server. The only honest cut is stopping the server,
 * which a Playwright-managed `webServer` cannot do mid-test — so this script owns the server
 * and kills it.
 *
 *   pnpm --filter @palscans/web build
 *   pnpm --filter @palscans/web verify:offline
 *
 * Exit code 0 means: a chapter was downloaded, the server was killed and confirmed
 * unreachable, and the chapter still rendered with its images painted from cache.
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from '@playwright/test'

const PORT = Number(process.env.PORT ?? 3199)
const BASE = `http://127.0.0.1:${PORT}`
const EMAIL = process.env.E2E_EMAIL ?? 'premium@palscans.org'
const PASSWORD = process.env.E2E_PASSWORD ?? 'palscans-dev'
const SERIES = process.env.E2E_SERIES ?? 'return-of-the-frost-monarch'

const reachable = async () => {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2000) })
    return res.status
  } catch {
    return null
  }
}

const step = (msg) => console.log(`  · ${msg}`)
let failed = false
const check = (ok, msg) => {
  console.log(`  ${ok ? '✓' : '✗'} ${msg}`)
  if (!ok) failed = true
}

const server = spawn('pnpm', ['exec', 'next', 'start', '-p', String(PORT)], {
  cwd: new URL('../', import.meta.url).pathname,
  stdio: 'ignore',
  detached: true,
})

let browser
try {
  for (let i = 0; i < 40 && (await reachable()) === null; i++) await sleep(500)
  if ((await reachable()) === null) throw new Error(`server never came up on ${BASE}`)
  step(`server up on ${BASE}`)

  browser = await chromium.launch()
  const page = await (await browser.newContext()).newPage()

  await page.goto(`${BASE}/login`, { waitUntil: 'load' })
  await page.locator('input[name="email"]').waitFor()
  await sleep(1500)
  await page.locator('input[name="email"]').fill(EMAIL)
  await page.locator('input[name="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 })
  step('signed in')

  await page.goto(`${BASE}/series/${SERIES}`, { waitUntil: 'load' })
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: 20_000,
  })
  step('service worker in control')

  const trigger = page.getByRole('button', { name: /^Download/ }).first()
  const sheet = page.getByRole('dialog')
  for (let i = 0; i < 20 && !(await sheet.isVisible()); i++) {
    await trigger.click().catch(() => undefined)
    await sleep(500)
  }
  await sheet.locator('li button:has-text("Download")').first().click()
  await page.waitForFunction(() => document.body.innerText.includes('Downloaded'), null, {
    timeout: 90_000,
  })
  step('chapter downloaded')

  // Prime the shell while the network still works.
  await page.goto(`${BASE}/offline`, { waitUntil: 'load' })
  await page.getByRole('heading', { name: 'Downloads' }).waitFor({ timeout: 20_000 })
  step('offline shell primed')

  // ---- the actual cut ----
  process.kill(-server.pid, 'SIGKILL')
  await sleep(2000)
  check((await reachable()) === null, 'server is unreachable')
  const fromPage = await page.evaluate(() =>
    fetch(`/api/health?x=${Math.random()}`, { cache: 'no-store' })
      .then((r) => `reachable:${r.status}`)
      .catch(() => 'blocked'),
  )
  check(fromPage === 'blocked', `the page cannot reach the network (${fromPage})`)

  await page.goto(`${BASE}/offline`, { waitUntil: 'domcontentloaded' }).catch(() => undefined)
  await page.getByRole('heading', { name: 'Downloads' }).waitFor({ timeout: 20_000 })
  const entries = await page.locator('li a[href^="/offline?c="]').count()
  check(entries > 0, `library lists ${entries} downloaded chapter(s) with no server`)

  await page.locator('li a[href^="/offline?c="]').first().click()
  await page.locator('#reader-root img').first().waitFor({ timeout: 20_000 })
  await sleep(1500)
  const painted = await page.evaluate(
    () =>
      Array.from(document.querySelectorAll('#reader-root img')).filter(
        (i) => i.complete && i.naturalWidth > 0,
      ).length,
  )
  check(painted > 0, `${painted} page image(s) painted from cache with no server`)

  await page.goto(`${BASE}/browse`, { waitUntil: 'domcontentloaded' }).catch(() => undefined)
  const heading = await page
    .getByRole('heading', { level: 1 })
    .first()
    .textContent()
    .catch(() => null)
  check(heading === 'Downloads', `a non-downloaded page falls back to the library (got ${heading})`)
} catch (err) {
  console.error('  ✗', err instanceof Error ? err.message : err)
  failed = true
} finally {
  await browser?.close().catch(() => undefined)
  try {
    process.kill(-server.pid, 'SIGKILL')
  } catch {
    // already dead — that is the point of the test
  }
}

console.log(
  failed ? '\noffline downloads NOT verified' : '\noffline downloads verified with no server',
)
process.exit(failed ? 1 : 0)
