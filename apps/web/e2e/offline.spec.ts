import { expect, test } from '@playwright/test'

/**
 * Offline downloads (docs/06 "Progress and offline", docs/17 §G).
 *
 * Runs desktop-only: it drives one browser context through sign-in, a download, and then
 * reading with the network cut, which is slow enough not to be worth doing twice.
 *
 * What this proves: a download stores the right manifest and exactly the right cached
 * responses, and `/offline` rebuilds the reader from them.
 *
 * What it cannot prove, and why: with a service worker in control, none of Playwright's
 * network controls reach the worker's own passthrough `fetch` — `context.setOffline()`,
 * `context.route()` (0 requests intercepted) and page-scoped CDP
 * `Network.emulateNetworkConditions` all leave the server reachable, so a test that "passes
 * offline" under them is quietly talking to a live server. The only honest cut is stopping
 * the server, which a managed `webServer` cannot do mid-test: that check lives in
 * `scripts/verify-offline.mjs`, which owns its own server and kills it.
 */
test.describe('offline downloads', () => {
  test.skip(({ isMobile }) => Boolean(isMobile), 'desktop only — the flow is slow')

  test('a Premium reader downloads a chapter and rereads it from the cache', async ({ page }) => {
    await page.goto('/login')
    // The form submits natively until React attaches; wait for the island.
    await expect(page.locator('input[name="email"]')).toBeVisible()
    await page.waitForTimeout(1500)
    await page.locator('input[name="email"]').fill('premium@palscans.org')
    await page.locator('input[name="password"]').fill('palscans-dev')
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 })

    await page.goto('/series/return-of-the-frost-monarch')
    // Registration is deferred to `load`, and downloads need the worker in control.
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
      timeout: 20_000,
    })

    // Click only once the island is interactive: a click before hydration is swallowed, and
    // the sheet never opens. Polling the outcome is more honest than sleeping a guess.
    const trigger = page.getByRole('button', { name: /^Download/ }).first()
    await expect(trigger).toBeVisible()
    const sheet = page.getByRole('dialog')
    await expect
      .poll(
        async () => {
          if (await sheet.isVisible()) return true
          await trigger.click().catch(() => undefined)
          return sheet.isVisible()
        },
        { timeout: 20_000, message: 'download sheet never opened' },
      )
      .toBe(true)
    const row = sheet.locator('li button:has-text("Keep offline")').first()
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.click()
    // Wait on the *row's own* button flipping to "On this device", not on the text
    // appearing anywhere: `getByText` is a case-insensitive substring match, and the sheet's
    // own description ("keep it on this device to read offline") matches it the moment the
    // sheet opens — which let this assertion pass before the download had started.
    await expect(sheet.locator('li button:has-text("On this device")').first()).toBeVisible({
      timeout: 60_000,
    })

    // What landed on disk: a manifest row, and one cached response per page plus the cover.
    const stored = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open('palscans-offline', 1)
        r.onsuccess = () => res(r.result)
        r.onerror = () => rej(r.error)
      })
      const rows = await new Promise<Array<{ pageCount: number; urls: string[] }>>((res, rej) => {
        const q = db.transaction('downloads').objectStore('downloads').getAll()
        q.onsuccess = () => res(q.result)
        q.onerror = () => rej(q.error)
      })
      const cached = (await (await caches.open('palscans-offline-v1')).keys()).length
      return { rows: rows.length, pages: rows[0]?.pageCount ?? 0, cached }
    })
    expect(stored.rows).toBe(1)
    expect(stored.pages).toBeGreaterThan(0)
    // Every page, plus the cover.
    expect(stored.cached).toBe(stored.pages + 1)

    // Prime the shell while the network still works.
    await page.goto('/offline')
    await expect(page.getByRole('heading', { name: 'Downloads' })).toBeVisible()

    const entry = page.locator('li a[href^="/offline?c="]').first()
    await expect(entry).toBeVisible()
    await entry.click()

    // The reader, rebuilt from IndexedDB. Every image must be one the download cached —
    // a page pointing at an uncached encode is exactly the bug pinning exists to prevent.
    const images = page.locator('#reader-root img')
    await expect(images.first()).toBeVisible({ timeout: 20_000 })
    const check = await page.evaluate(async () => {
      const cached = new Set(
        (await (await caches.open('palscans-offline-v1')).keys()).map((r) => r.url),
      )
      const imgs = Array.from(document.querySelectorAll('#reader-root img')) as HTMLImageElement[]
      return {
        painted: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
        uncached: imgs.map((i) => i.currentSrc || i.src).filter((u) => u && !cached.has(u)),
      }
    })
    expect(check.painted).toBeGreaterThan(0)
    expect(check.uncached).toEqual([])
  })
})
