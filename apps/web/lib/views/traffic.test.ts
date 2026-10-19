import { beforeEach, describe, expect, it } from 'vitest'

// The site's own host comes from SITE_URL, and "is this referral our own page?" is the
// rule most of this file is about — so the environment has to say who we are first.
process.env.SITE_URL = 'https://palscans.org'

const { countTraffic, flushTraffic, signupAttribution } = await import('./traffic')

/**
 * Counting where visits came from.
 *
 * Every test here is about something that fails *quietly*. A counter that also counts the
 * site referring itself still renders a panel — one that says "Within the site, 98%". A
 * buffer that grows on attacker-supplied tags still answers requests, until the box runs
 * out of memory. Neither throws, and neither shows up in a log.
 */

const flushed: Array<{ bucket: string; source: string; campaign: string; hits: number }> = []
const collect = async (
  rows: Array<{ bucket: string; source: string; campaign: string; hits: number }>,
) => {
  flushed.push(...rows)
}

beforeEach(async () => {
  await flushTraffic(async () => {})
  flushed.length = 0
})

const at = new Date('2026-10-19T12:00:00Z')

describe('countTraffic', () => {
  it('buckets a visit and batches repeats of it', async () => {
    countTraffic('https://x.com/palscans/status/1', null, at)
    countTraffic('https://x.com/palscans/status/1', null, at)
    countTraffic('https://discord.com/channels/1', null, at)
    await flushTraffic(collect)

    expect(flushed).toHaveLength(2)
    expect(flushed.find((r) => r.source === 'x')?.hits).toBe(2)
    expect(flushed.find((r) => r.source === 'discord')?.hits).toBe(1)
    expect(flushed[0]?.bucket).toBe('2026-10-19')
  })

  it('does not count the site referring itself', async () => {
    // Without this every real source is buried under the site itself, and the panel looks
    // fine while saying nothing.
    countTraffic('https://palscans.org/series/one-piece', null, at)
    countTraffic('https://palscans.org/', null, at)
    await flushTraffic(collect)
    expect(flushed).toEqual([])
  })

  it('keeps the link tag separate from the site it was clicked on', async () => {
    countTraffic('https://x.com/a', 'x-bio', at)
    countTraffic('https://x.com/a', 'x-pinned', at)
    await flushTraffic(collect)
    expect(flushed.map((r) => r.campaign).sort()).toEqual(['x-bio', 'x-pinned'])
    expect(flushed.every((r) => r.source === 'x')).toBe(true)
  })

  it('cannot be grown without limit by inventing tags', async () => {
    // `?ref=` is attacker-supplied: a script trying a new one each request would otherwise
    // add a map entry every time, on a 2 GB box, with nothing to stop it.
    for (let i = 0; i < 900; i++) countTraffic('https://x.com/a', `tag-${i}`, at)
    await flushTraffic(collect)
    expect(flushed.length).toBeLessThanOrEqual(501)
    // The visits past the cap still count, under their source with no tag — the part worth
    // keeping is kept.
    const untagged = flushed.find((r) => r.source === 'x' && r.campaign === '')
    expect(untagged?.hits).toBeGreaterThan(0)
    const total = flushed.reduce((sum, r) => sum + r.hits, 0)
    expect(total).toBe(900)
  })

  it('empties itself on a flush, so a count is never written twice', async () => {
    countTraffic('https://reddit.com/r/manga', null, at)
    await flushTraffic(collect)
    await flushTraffic(collect)
    expect(flushed).toHaveLength(1)
  })

  it('drops counts rather than retrying them when the write fails', async () => {
    countTraffic('https://x.com/a', null, at)
    await flushTraffic(async () => {
      throw new Error('database is down')
    })
    // Nothing queued for a retry: these are rounded numbers on an admin panel, and a
    // growing retry queue on a small box is a worse failure than a missing minute.
    await flushTraffic(collect)
    expect(flushed).toEqual([])
  })
})

describe('signupAttribution', () => {
  it('stores the bucket, never the referrer', () => {
    // A referrer URL can carry the search query that led here. "Google" is the fact worth
    // keeping; the words somebody typed are not ours to keep.
    const attribution = signupAttribution('https://www.google.com/search?q=one+piece+1196', null)
    expect(attribution).toEqual({ signupSource: 'google', signupCampaign: null })
    expect(JSON.stringify(attribution)).not.toContain('one+piece')
  })

  it('records a sign-up that started on the site as unknown, not as our own referral', () => {
    expect(signupAttribution('https://palscans.org/series/a', null).signupSource).toBeNull()
  })

  it('keeps the link tag when there is one', () => {
    expect(signupAttribution('https://discord.gg/x', 'credit-page')).toEqual({
      signupSource: 'discord',
      signupCampaign: 'credit-page',
    })
  })
})
