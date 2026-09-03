/**
 * Drives the real Integrations screen: save, reload, clear, and prove the secret mask does not
 * round-trip. Temporary verification harness — not part of the suite.
 *
 *   node apps/web/verify-integrations.mjs "<sid cookie value>"
 */
import { chromium } from '@playwright/test'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3210'
const COOKIE = process.argv[2]
const OUT = process.env.OUT ?? '/tmp/shots'

const CDN = 'cfg-storage-public_cdn_url'
const SECRET = 'cfg-email-resend_api_key'

const log = (...a) => console.log('•', ...a)
const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra })
  console.log(ok ? `  PASS ${name} ${extra}` : `  FAIL ${name} ${extra}`)
}

const sourceOf = async (page, id) =>
  page.evaluate((domId) => {
    const label = document.querySelector(`label[for="${domId}"]`)
    return label?.parentElement?.querySelector('span')?.textContent?.trim() ?? null
  }, id)

const save = async (page) => {
  const button = page.getByRole('button', { name: /Save changes|Saving/ })
  await button.click()
  await page.waitForResponse(
    (r) => r.url().includes('/api/admin/integrations') && r.request().method() === 'PUT',
  )
  await page.waitForTimeout(400)
}

const main = async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  })
  await context.addCookies([
    { name: 'sid', value: COOKIE, url: BASE, httpOnly: true, sameSite: 'Lax' },
  ])
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message))

  await page.goto(`${BASE}/admin/integrations`, { waitUntil: 'networkidle' })
  check('screen renders', (await page.locator('h1').first().textContent()) === 'Integrations')
  check('nav has the link', (await page.locator('a[href="/admin/integrations"]').count()) > 0)
  check(
    'every group panel is present',
    (await page.locator('section h2').allTextContents()).length === 7,
    (await page.locator('section h2').allTextContents()).join(' · '),
  )

  await page.screenshot({ path: `${OUT}/integrations-1440.png`, fullPage: true })

  /* ---------------------------------------------- 1. save a plain value, reload, confirm */
  log('saving a panel value')
  const before = await sourceOf(page, CDN)
  await page.fill(`#${CDN}`, 'https://cdn.verify.example.org')
  await save(page)
  await page.reload({ waitUntil: 'networkidle' })
  check(
    'value persisted',
    (await page.inputValue(`#${CDN}`)) === 'https://cdn.verify.example.org',
    await page.inputValue(`#${CDN}`),
  )
  const after = await sourceOf(page, CDN)
  check('source became Panel', after === 'Panel', `${before} → ${after}`)

  /* --------------------------------------------------- 2. clear it, fall back to the env */
  log('clearing it again')
  await page.fill(`#${CDN}`, '')
  await save(page)
  await page.reload({ waitUntil: 'networkidle' })
  const cleared = await sourceOf(page, CDN)
  check(
    'source fell back to Environment',
    cleared === 'Environment',
    `value now ${JSON.stringify(await page.inputValue(`#${CDN}`))}`,
  )

  /* -------------------------------------------------------------- 3. the secret round trip */
  log('storing a secret')
  await page.fill(`#${SECRET}`, 're_verification_key_do_not_use')
  await save(page)
  await page.reload({ waitUntil: 'networkidle' })
  const shown = await page.inputValue(`#${SECRET}`)
  const readOnly = await page.locator(`#${SECRET}`).evaluate((el) => el.readOnly)
  check('a stored secret reads as "Set"', shown === 'Set' && readOnly, `value=${shown}`)
  check('and its source is Panel', (await sourceOf(page, SECRET)) === 'Panel')
  check(
    'the real value never reaches the browser',
    !(await page.content()).includes('re_verification_key_do_not_use'),
  )

  /* --------------------------------------------------------------- 4. run a real test */
  log('running the storage connection test')
  const panel = page.locator('section', { has: page.getByRole('heading', { name: 'Storage' }) })
  await panel.getByRole('button', { name: /^Test$/ }).click()
  await page.waitForResponse(
    (r) => r.url().includes('/api/admin/integrations') && r.request().method() === 'POST',
  )
  await page.waitForTimeout(600)
  const verdict = await panel.locator('ul li').allTextContents()
  check('the test reported checks', verdict.length > 0, verdict.join(' | ').slice(0, 200))
  await page.screenshot({ path: `${OUT}/integrations-test-1440.png`, fullPage: true })

  /* ------------------------------------------------------------------ 5. 390px, overflow */
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: 'dark',
    deviceScaleFactor: 2,
  })
  await mobile.addCookies([
    { name: 'sid', value: COOKIE, url: BASE, httpOnly: true, sameSite: 'Lax' },
  ])
  const small = await mobile.newPage()
  await small.goto(`${BASE}/admin/integrations`, { waitUntil: 'networkidle' })
  await small.screenshot({ path: `${OUT}/integrations-390.png`, fullPage: true })
  const overflow = await small.evaluate(() => {
    const doc = document.documentElement
    const widest = [...document.querySelectorAll('body *')]
      .map((el) => ({ w: el.getBoundingClientRect().right, t: el.tagName + '.' + el.className }))
      .filter((x) => x.w > window.innerWidth + 1)
      .slice(0, 3)
    return { scrollWidth: doc.scrollWidth, innerWidth: window.innerWidth, widest }
  })
  check(
    'no horizontal overflow at 390px',
    overflow.scrollWidth <= overflow.innerWidth,
    JSON.stringify(overflow),
  )

  await browser.close()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
