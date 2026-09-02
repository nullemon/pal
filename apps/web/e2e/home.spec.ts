import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const shots = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test-results/f1')

test('home renders the shell', async ({ page, isMobile }) => {
  await page.goto('/')
  await expect(page.getByRole('banner')).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: /trending/i })).toBeVisible()
  await expect(page.getByRole('contentinfo')).toContainText('© 2026 PALScans')
  await expect(page.locator('[data-ad-slot="home_top"]')).toBeVisible()
  const bottomNav = page.getByRole('navigation', { name: 'Primary, mobile' })
  if (isMobile) await expect(bottomNav).toBeVisible()
  else await expect(bottomNav).toBeHidden()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({
    path: path.join(shots, isMobile ? 'home-mobile.png' : 'home.png'),
    fullPage: true,
  })
})
