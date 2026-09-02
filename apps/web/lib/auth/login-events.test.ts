import { describe, expect, it } from 'vitest'
import { formatPlace, geoFromHeaders, isSpike, parseUserAgent } from './login-events'

const UA = {
  chromeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  operaWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chromeIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
  chromeAndroidPhone:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  chromeAndroidTablet:
    'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  safariIpad:
    'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/604.1',
  samsung:
    'Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
  chromeOs:
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  bot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  curl: 'curl/8.5.0',
}

describe('parseUserAgent', () => {
  it('reads the browser past the compatibility tokens every engine copies', () => {
    expect(parseUserAgent(UA.chromeMac)).toEqual({
      device: 'Desktop',
      browser: 'Chrome',
      os: 'macOS',
    })
    // Edge and Opera both claim "Chrome"; Chrome claims "Safari".
    expect(parseUserAgent(UA.edgeWindows).browser).toBe('Edge')
    expect(parseUserAgent(UA.operaWindows).browser).toBe('Opera')
    expect(parseUserAgent(UA.safariIphone).browser).toBe('Safari')
    expect(parseUserAgent(UA.chromeIos).browser).toBe('Chrome')
    expect(parseUserAgent(UA.samsung).browser).toBe('Samsung Internet')
    expect(parseUserAgent(UA.firefoxLinux).browser).toBe('Firefox')
  })

  it('names the operating system', () => {
    expect(parseUserAgent(UA.edgeWindows).os).toBe('Windows')
    expect(parseUserAgent(UA.safariIphone).os).toBe('iOS')
    expect(parseUserAgent(UA.safariIpad).os).toBe('iPadOS')
    expect(parseUserAgent(UA.chromeAndroidPhone).os).toBe('Android')
    expect(parseUserAgent(UA.firefoxLinux).os).toBe('Linux')
    // ChromeOS also says X11 and Linux — the more specific token wins.
    expect(parseUserAgent(UA.chromeOs).os).toBe('ChromeOS')
  })

  it('separates phones from tablets from desktops', () => {
    expect(parseUserAgent(UA.chromeAndroidPhone).device).toBe('Mobile')
    expect(parseUserAgent(UA.safariIphone).device).toBe('Mobile')
    // Android tablets drop the "Mobile" token; iPads say iPad.
    expect(parseUserAgent(UA.chromeAndroidTablet).device).toBe('Tablet')
    expect(parseUserAgent(UA.safariIpad).device).toBe('Tablet')
    expect(parseUserAgent(UA.chromeMac).device).toBe('Desktop')
  })

  it('flags crawlers and command-line clients as bots', () => {
    expect(parseUserAgent(UA.bot).device).toBe('Bot')
    expect(parseUserAgent(UA.curl).device).toBe('Bot')
  })

  it('never throws on a missing or nonsense agent', () => {
    expect(parseUserAgent(null)).toEqual({
      device: 'Unknown',
      browser: 'Unknown',
      os: 'Unknown',
    })
    expect(parseUserAgent('   ')).toEqual({
      device: 'Unknown',
      browser: 'Unknown',
      os: 'Unknown',
    })
    expect(parseUserAgent('????').device).toBe('Unknown')
  })
})

const geo = (h: Record<string, string>) => geoFromHeaders(new Headers(h))

describe('geoFromHeaders', () => {
  it('takes the country and city Cloudflare sends', () => {
    expect(geo({ 'cf-ipcountry': 'de', 'cf-ipcity': 'Berlin' })).toEqual({
      country: 'DE',
      city: 'Berlin',
    })
  })
  it('ignores the placeholders Cloudflare uses for unknown and Tor', () => {
    expect(geo({ 'cf-ipcountry': 'XX' }).country).toBeNull()
    expect(geo({ 'cf-ipcountry': 'T1' }).country).toBeNull()
    expect(geo({ 'cf-ipcountry': 'not a code!' }).country).toBeNull()
  })
  it('is empty behind any other proxy', () => {
    expect(geo({})).toEqual({ country: null, city: null })
  })
  it('formats what it has', () => {
    expect(formatPlace({ country: 'DE', city: 'Berlin' })).toBe('Berlin, DE')
    expect(formatPlace({ country: 'DE', city: null })).toBe('DE')
    expect(formatPlace({ country: null, city: null })).toBeNull()
  })
})

describe('isSpike', () => {
  it('needs a real jump and a floor, so a quiet night stays quiet', () => {
    expect(isSpike(1, 0)).toBe(false)
    expect(isSpike(9, 0)).toBe(false)
    expect(isSpike(10, 0)).toBe(true)
    expect(isSpike(10, 4)).toBe(false)
    expect(isSpike(30, 10)).toBe(true)
    expect(isSpike(30, 11)).toBe(false)
  })
})
