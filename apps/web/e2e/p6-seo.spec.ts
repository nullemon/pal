import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

/**
 * P6 screenshots: the admin SEO screen, a genre feed, /sitemap.xml and the 404 page.
 * Run against `next start` (build first): `E2E_PORT=3106 pnpm --filter @palscans/web exec playwright test e2e/p6-seo.spec.ts`.
 */
const shots = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test-results/p6')
const suffix = (isMobile: boolean) => (isMobile ? '-mobile' : '')

test('404 page renders search and popular series', async ({ page, isMobile }) => {
  const res = await page.goto('/this-page-does-not-exist')
  expect(res?.status()).toBe(404)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/page not found/i)
  await expect(page.getByRole('searchbox', { name: /search the catalogue/i })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({
    path: path.join(shots, `not-found${suffix(isMobile)}.png`),
    fullPage: true,
  })
})

test('sitemap index and a child sitemap', async ({ page, request, isMobile }) => {
  test.skip(isMobile, 'text output; one screenshot is enough')
  const index = await request.get('/sitemap.xml')
  expect(index.status()).toBe(200)
  expect(index.headers()['content-type']).toContain('xml')
  const xml = await index.text()
  expect(xml).toContain('<sitemapindex')
  expect(xml).toContain('/sitemaps/series-1.xml.gz')
  const child = await request.get('/sitemaps/series-1.xml.gz')
  expect(child.status()).toBe(200)
  await page.goto('/sitemap.xml')
  await page.screenshot({ path: path.join(shots, 'sitemap-xml.png'), fullPage: true })
})

test('genre feed renders RSS and Atom', async ({ page, request, isMobile }) => {
  test.skip(isMobile, 'text output; one screenshot is enough')
  const rss = await request.get('/genres/action/feed')
  expect(rss.status()).toBe(200)
  expect(rss.headers()['content-type']).toContain('application/rss+xml')
  const body = await rss.text()
  expect(body).toContain('<rss version="2.0"')
  expect(body).toContain('<item>')
  const atom = await request.get('/genres/action/feed?format=atom')
  expect(atom.headers()['content-type']).toContain('application/atom+xml')
  const site = await request.get('/feed')
  expect(site.status()).toBe(200)
  await page.goto('/genres/action/feed')
  await page.screenshot({ path: path.join(shots, 'genre-feed.png'), fullPage: true })
})

test('robots.txt lists the sitemap', async ({ request }) => {
  const res = await request.get('/robots.txt')
  expect(res.status()).toBe(200)
  expect(await res.text()).toContain('Sitemap: ')
})

test('legal pages and announcements render', async ({ page, isMobile }) => {
  await page.goto('/dmca')
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/dmca/i)
  await expect(page.getByRole('button', { name: /send notice/i })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: path.join(shots, `dmca${suffix(isMobile)}.png`), fullPage: true })
  await page.goto('/announcements')
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/announcements/i)
  await page.screenshot({
    path: path.join(shots, `announcements${suffix(isMobile)}.png`),
    fullPage: true,
  })
  await page.goto('/announcements/welcome-to-palscans')
  await expect(page.locator('script[type="application/ld+json"]').first()).toHaveCount(1)
  await page.screenshot({
    path: path.join(shots, `announcement${suffix(isMobile)}.png`),
    fullPage: true,
  })
})

test('admin SEO screen', async ({ page, isMobile, baseURL }) => {
  // Sign in through the API (shares the browser context's cookie jar); the Origin header
  // satisfies the same-origin check on mutating routes.
  const login = await page.request.post('/api/auth/login', {
    data: { email: 'admin@palscans.org', password: 'palscans-dev' },
    headers: { origin: baseURL ?? '' },
  })
  expect(login.ok()).toBe(true)
  await page.goto('/admin/seo')
  await expect(page.getByRole('heading', { level: 1, name: 'SEO' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({
    path: path.join(shots, `admin-seo-identity${suffix(isMobile)}.png`),
    fullPage: true,
  })
  for (const tab of ['Templates', 'Sitemap', 'Redirects', 'robots.txt']) {
    const button = page.getByRole('button', { name: tab, exact: true })
    await button.click()
    await expect(button).toHaveAttribute('aria-current', 'page')
    if (tab === 'Templates') await page.waitForTimeout(1500)
    await page.screenshot({
      path: path.join(
        shots,
        `admin-seo-${tab.replace(/\W+/g, '-').toLowerCase()}${suffix(isMobile)}.png`,
      ),
      fullPage: true,
    })
  }
})
