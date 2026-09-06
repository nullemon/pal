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

/** The vocabulary `?status=` accepts, and the chips a series page draws for it. */
const STATUSES = ['ongoing', 'completed', 'hiatus', 'cancelled', 'dropped'] as const
const STATUS_LABELS = ['Ongoing', 'Completed', 'Hiatus', 'Cancelled', 'Dropped']

/**
 * One /browse page: the total it reports, and the series it actually rendered. Scoped to
 * `main` so the header's own links cannot pad the list, and to card links (`/series/<slug>`)
 * so the "latest chapter" link on each card is not counted as a second series.
 */
const browse = async (page: import('@playwright/test').Page, query = '') => {
  await page.goto(`/browse${query}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const results = await page
    .getByText(/^[\d,]+ series$/)
    .first()
    .textContent()
  const slugs = await page
    .getByRole('main')
    .locator('a[href^="/series/"]')
    .evaluateAll((els) => [
      ...new Set(
        els
          .map((el) => el.getAttribute('href') ?? '')
          .filter((href) => /^\/series\/[^/]+$/.test(href)),
      ),
    ])
  return { total: Number((results ?? '').replace(/\D/g, '')), slugs }
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

  /**
   * `?status=` decides which series are on the page, so every assertion here is one an
   * ignored filter fails: the count must *drop*, the sets must not overlap, the statuses must
   * add up to the whole catalogue, and every card on the completed page must be a series
   * whose own page says Completed. Counting cards and allowing "the same or fewer" is what
   * this replaced — an ignored filter returns the unfiltered list, which is "the same".
   */
  test('the browse filters narrow the catalogue', async ({ page }) => {
    test.setTimeout(180_000)
    const all = await browse(page)
    expect(all.slugs.length).toBeGreaterThan(0)
    expect(all.total).toBeGreaterThanOrEqual(all.slugs.length)

    const completed = await browse(page, '?status=completed')
    expect(completed.slugs.length).toBeGreaterThan(0)
    expect(completed.total).toBeLessThan(all.total)

    // Two statuses cannot share a series, so an ignored filter is caught here even if the
    // catalogue were one day entirely completed.
    const ongoing = await browse(page, '?status=ongoing')
    expect(completed.slugs.filter((slug) => ongoing.slugs.includes(slug))).toEqual([])

    // …and every series has exactly one status, so the parts add up to the whole.
    let sum = 0
    for (const status of STATUSES) sum += (await browse(page, `?status=${status}`)).total
    expect(sum).toBe(all.total)

    // The strongest form of the claim: every card the filter returned really is completed,
    // read off the series' own page rather than inferred from the count.
    for (const slug of completed.slugs) {
      await page.goto(slug, { waitUntil: 'domcontentloaded' })
      const chips = await page.locator('h1 + div span').allTextContents()
      expect(
        chips.map((c) => c.trim()).filter((c) => STATUS_LABELS.includes(c)),
        slug,
      ).toEqual(['Completed'])
    }
  })
})

/**
 * The uploader, not the admin: `chapter.update` is all this needs, and docs/07 requires a
 * second factor of real *administrators* — which the seeded admin has, so signing in as one
 * from a test is not possible. A role that needs no second factor is not a shortcut here, it
 * is the least privilege the job takes.
 */
const STAFF = { email: 'uploader@palscans.org', password: 'palscans-dev' }
/** Far enough down the list to be nobody else's fixture, near enough the top to be rendered. */
/**
 * The chapter this test locks, per project.
 *
 * It must differ between `desktop` and `mobile`: the two projects run in parallel against
 * one server and one database, so a shared number means each run locks the chapter the other
 * is reading — the chapter-list test a few lines up starts failing, and the cause looks like
 * anything but this. Found exactly that way: serial passed, parallel did not.
 */
const LOCKED_BY_PROJECT: Record<string, number> = { desktop: 300, mobile: 299 }
const lockedChapter = (project: string): number => LOCKED_BY_PROJECT[project] ?? 300

/**
 * A JSON call made *by the browser*, from inside `p`'s context.
 *
 * Not Playwright's `request` fixture: `next start` marks the session cookie `Secure`, and only
 * a real browser applies the loopback exception that lets a Secure cookie travel over http to
 * 127.0.0.1. Through the API fixture the cookie is silently dropped and every staff call comes
 * back 401.
 */
const call = (
  p: import('@playwright/test').Page,
  path: string,
  init: { method?: string; body?: unknown } = {},
) =>
  p.evaluate(
    async ([path, init]: [string, { method?: string; body?: unknown }]) => {
      const res = await fetch(path, {
        method: init.method ?? 'GET',
        headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      })
      return { status: res.status, json: (await res.json().catch(() => null)) as unknown }
    },
    [path, init] as [string, { method?: string; body?: unknown }],
  )

test.describe('the paywall', () => {
  /**
   * This test locks a chapter itself and puts it back.
   *
   * It used to look for one in the catalogue and `test.skip` when it found none — and it found
   * none, on every run: the locator wants the early-access badge, and nothing in a seeded
   * database carries a *live* early-access window (the seeded ones have long expired, and the
   * permanently-premium chapters render "Premium", not "Premium only"). So the gate, the "no
   * page URLs in the HTML" rule and the 403 were never once asserted. The
   * `document.body.dataset.chapterId` the API check read does not exist anywhere in the app
   * either, so that half was dead twice over.
   *
   * The window is set by staff, the assertions run in the anonymous browser context, and
   * `finally` puts the chapter back however they go.
   */
  test('a locked chapter shows the gate and never a page URL', async ({ page, browser }, info) => {
    // One project only. This asserts server behaviour — the gate in the HTML, no page URL,
    // a 403 from the pages API — none of which depends on the viewport. Running it in both
    // projects at once made it flaky for a reason worth recording: the two share one staff
    // account and one 5/min per-address sign-in budget, so they starve each other, and they
    // mutate the same chapter, so each one locks what the other is reading. The failure then
    // surfaces in *other* tests, which is the expensive kind of flake.
    test.skip(info.project.name !== 'desktop', 'server behaviour; desktop covers it')
    const LOCKED = lockedChapter(info.project.name)
    // Long enough to wait out the sign-in limit below and the cache purge at the end.
    test.setTimeout(240_000)
    const staff = await browser.newContext()
    const staffPage = await staff.newPage()
    await staffPage.goto('/')
    // Sign-in is 5/min per IP (docs/07) and every test in this suite that signs in shares
    // that budget from one address, so a 429 here is the neighbours, not the site. Waited out
    // rather than skipped: this account is staff *without* a second factor by design (see
    // STAFF), so there is no honest reason for this test not to run.
    let login = { status: 0, json: null as unknown }
    await expect
      .poll(
        async () => {
          login = await call(staffPage, '/api/auth/login', { method: 'POST', body: STAFF })
          return login.status
        },
        // A tripped limit blocks for 60s and a blocked attempt costs nothing more (it is
        // refused before the counter is touched), so the retries are spaced to land after it.
        { timeout: 200_000, intervals: [0, 10_000, 65_000, 65_000], message: 'staff sign-in' },
      )
      .toBe(200)
    expect(login.json, 'staff sign-in').toMatchObject({ data: { mfa: false } })

    const slug = SERIES.replace('/series/', '')
    const found = await call(staffPage, `/api/admin/series/search?q=${slug}`)
    const seriesId = (found.json as { data: Array<{ id: number; slug: string }> }).data.find(
      (row) => row.slug === slug,
    )?.id as number
    expect(seriesId, `no series ${slug}`).toBeGreaterThan(0)
    const numbers = await call(staffPage, `/api/admin/series/${seriesId}/numbers`)
    const chapterId = (numbers.json as { data: Array<{ id: number; number: number }> }).data.find(
      (row) => Number(row.number) === LOCKED,
    )?.id as number
    expect(chapterId, `no chapter ${LOCKED}`).toBeGreaterThan(0)

    const window = (until: string | null) =>
      call(staffPage, `/api/admin/chapters/${chapterId}`, {
        method: 'PATCH',
        body: { earlyAccessUntil: until },
      })

    expect(await window(new Date(Date.now() + 3_600_000).toISOString())).toMatchObject({
      status: 200,
    })
    try {
      await page.goto(`${SERIES}/chapter-${LOCKED}`)
      await expect(page.locator('#locked-title')).toBeVisible()
      // docs/06: "Page URLs are never emitted for a chapter the user may not read."
      expect(await page.content()).not.toMatch(/_storage\/pages\//)
      // And the API agrees for the same visitor.
      expect((await page.request.get(`/api/chapters/${chapterId}/pages`)).status()).toBe(403)

      // The chapter list marks the row too: the reader's warning before they click. Polled,
      // and with a fresh URL each time, because the admin save purges a cached series page
      // rather than rewriting it — the gate above is per-request and needs no such patience.
      await expect(async () => {
        await page.goto(`${SERIES}?t=${Date.now()}`)
        await expect(
          page.locator(`a[href$="/chapter-${LOCKED}"]:has-text("Premium only")`),
        ).toBeVisible({ timeout: 10_000 })
      }).toPass({ timeout: 60_000 })
    } finally {
      expect(await window(null), 'the chapter must be put back').toMatchObject({ status: 200 })
      await staff.close()
    }

    // The gate is the window, not something the chapter carries from now on.
    await expect(async () => {
      await page.goto(`${SERIES}/chapter-${LOCKED}`)
      await expect(page.locator('#locked-title')).toHaveCount(0)
      await expect(page.locator('#reader-root img').first()).toBeVisible()
    }).toPass({ timeout: 20_000 })
  })
})
