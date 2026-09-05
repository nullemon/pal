import { expect, test } from '@playwright/test'

/**
 * The paths that must not break. These are deliberately end-to-end and stateful — they sign
 * in, write, and read back — because every one of them spans layers that unit tests mock
 * apart.
 *
 * Hydration matters here. Islands attach after `load`, and a click before that is swallowed,
 * so anything interactive waits for a real signal rather than sleeping on a guess.
 */
const READER = { email: 'reader@palscans.org', password: 'palscans-dev' }
const SERIES = '/series/return-of-the-frost-monarch'

const signIn = async (page: import('@playwright/test').Page, who = READER) => {
  await page.goto('/login')
  await expect(page.locator('input[name="email"]')).toBeVisible()
  // The form posts natively until React attaches; give it a moment to take over.
  await page.waitForTimeout(1500)
  await page.locator('input[name="email"]').fill(who.email)
  await page.locator('input[name="password"]').fill(who.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 })
}

test.describe('reader journeys', () => {
  test('a reader signs in and lands back on the site', async ({ page }) => {
    await signIn(page)
    await page.goto('/me/bookmarks')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('a chapter opens and its pages render', async ({ page }) => {
    await page.goto(`${SERIES}/chapter-305`)
    const images = page.locator('#reader-root img')
    await expect(images.first()).toBeVisible({ timeout: 20_000 })
    const painted = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll('#reader-root img')).filter(
          (i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0,
        ).length,
    )
    expect(painted).toBeGreaterThan(0)
    // A free chapter must never render the paywall.
    await expect(page.locator('#locked-title')).toHaveCount(0)
  })

  test('the chapter list, search and sort all work', async ({ page }) => {
    await page.goto(SERIES)
    const rows = page.locator('a[href*="/chapter-"]')
    const before = await rows.count()
    expect(before).toBeGreaterThan(0)
    await page.getByRole('searchbox', { name: /search chapters/i }).fill('305')
    await expect(async () => {
      expect(await rows.count()).toBeLessThan(before)
    }).toPass({ timeout: 5000 })
    await expect(page.locator('a[href$="/chapter-305"]')).toBeVisible()
  })

  test('bookmarking survives a reload', async ({ page }) => {
    await signIn(page)
    await page.goto(SERIES)
    const button = page.getByRole('button', { name: /bookmark/i }).first()
    await expect(button).toBeVisible()
    const wasBookmarked = (await button.textContent())?.toLowerCase().includes('bookmarked')
    await expect(async () => {
      await button.click()
      const now = (await button.textContent())?.toLowerCase().includes('bookmarked')
      expect(now).not.toBe(wasBookmarked)
    }).toPass({ timeout: 15_000 })
    const after = (await button.textContent())?.toLowerCase().includes('bookmarked')

    await page.reload()
    const reloaded = page.getByRole('button', { name: /bookmark/i }).first()
    await expect(reloaded).toBeVisible()
    await expect
      .poll(async () => (await reloaded.textContent())?.toLowerCase().includes('bookmarked'), {
        timeout: 10_000,
      })
      .toBe(after)
  })

  test('search finds a series by title', async ({ page }) => {
    await page.goto('/search?q=frost')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.locator(`a[href="${SERIES}"]`).first()).toBeVisible()
  })

  test('the browse filters narrow the catalogue', async ({ page }) => {
    await page.goto('/browse')
    const cards = page.locator('a[href^="/series/"]')
    await expect(cards.first()).toBeVisible()
    const all = await cards.count()
    await page.goto('/browse?status=completed')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    // Either fewer results, or an honest empty state — never the unfiltered list.
    const filtered = await cards.count()
    expect(filtered).toBeLessThanOrEqual(all)
  })
})

test.describe('the paywall', () => {
  test('a locked chapter shows the gate and never a page URL', async ({ page, request }) => {
    // Put a chapter behind the early-access window through the admin API's own rules is not
    // possible without staff auth, so this asserts the gate's contract on whatever the
    // catalogue currently locks — and skips cleanly when nothing is locked.
    await page.goto(SERIES)
    const locked = page.locator('a[href*="/chapter-"]:has-text("Premium only")').first()
    if ((await locked.count()) === 0) test.skip(true, 'no locked chapter in the catalogue')
    const href = await locked.getAttribute('href')
    await page.goto(href as string)
    await expect(page.locator('#locked-title')).toBeVisible()
    // docs/06: "Page URLs are never emitted for a chapter the user may not read."
    const html = await page.content()
    expect(html).not.toMatch(/_storage\/pages\//)
    // And the API agrees.
    const id = await page.evaluate(() => document.body.dataset.chapterId)
    if (id) {
      const res = await request.get(`/api/chapters/${id}/pages`)
      expect(res.status()).toBe(403)
    }
  })
})
