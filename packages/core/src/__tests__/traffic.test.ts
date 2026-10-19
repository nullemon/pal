import { describe, expect, it } from 'vitest'
import {
  CAMPAIGN_MAX,
  classifyTraffic,
  isCountableSource,
  normaliseCampaign,
  TRAFFIC_SOURCE_LABELS,
} from '../traffic.js'

/**
 * Bucketing a visit by where it came from.
 *
 * The rule that matters most is the one about this site: a reader moving from chapter 1 to
 * chapter 2 is not a new visit from anywhere, and counting those would bury every real
 * source under the site itself — which is the failure mode where the report looks fine and
 * says nothing.
 */

const SELF = 'palscans.org'
const of = (referrer: string | null, ref: string | null = null) =>
  classifyTraffic(referrer, ref, SELF)

describe('classifyTraffic', () => {
  it('knows the places a manga site is actually linked from', () => {
    expect(of('https://x.com/palscans/status/1').source).toBe('x')
    expect(of('https://t.co/abc').source).toBe('x')
    expect(of('https://twitter.com/x').source).toBe('x')
    expect(of('https://discord.com/channels/1/2').source).toBe('discord')
    expect(of('https://discord.gg/invite').source).toBe('discord')
    expect(of('https://www.reddit.com/r/manga/').source).toBe('reddit')
    expect(of('https://youtu.be/abc').source).toBe('youtube')
    expect(of('https://t.me/channel').source).toBe('telegram')
  })

  it('treats every Google country host as Google', () => {
    for (const host of ['google.com', 'www.google.de', 'google.co.uk', 'news.google.com']) {
      expect(of(`https://${host}/search?q=one+piece`).source, host).toBe('google')
    }
  })

  it('calls a visit with no referrer direct', () => {
    expect(of(null).source).toBe('direct')
    expect(of('').source).toBe('direct')
    // A referrer header that is not a URL is not a source; it is noise.
    expect(of('not a url').source).toBe('direct')
  })

  it('does not count the site referring itself', () => {
    expect(of('https://palscans.org/series/one-piece').source).toBe('internal')
    expect(of('https://www.palscans.org/').source).toBe('internal')
    expect(of('https://img.palscans.org/x.jpg').source).toBe('internal')
    expect(isCountableSource('internal')).toBe(false)
    expect(isCountableSource('x')).toBe(true)
  })

  it('does not mistake a lookalike host for the real one', () => {
    // The failure this guards is `evil-x.com` or `palscans.org.phish.net` being filed as X
    // or as internal, which would quietly corrupt the one report this table exists for.
    expect(of('https://evil-x.com/a').source).toBe('other')
    expect(of('https://palscans.org.phish.net/a').source).toBe('other')
    expect(of('https://notdiscord.gg/a').source).toBe('other')
  })

  it('keeps the campaign tag beside the source, not instead of it', () => {
    // Which link was clicked, and where it was clicked — two questions, two fields.
    expect(of('https://discord.com/x', 'x-bio')).toEqual({ source: 'discord', campaign: 'x-bio' })
    expect(of(null, 'print-flyer')).toEqual({ source: 'direct', campaign: 'print-flyer' })
    expect(of('https://x.com/a')).toEqual({ source: 'x', campaign: '' })
  })

  it('labels every source it can return', () => {
    // A missing label renders as nothing in the panel, which reads as a bug in the data.
    for (const source of Object.keys(TRAFFIC_SOURCE_LABELS)) {
      expect(TRAFFIC_SOURCE_LABELS[source as keyof typeof TRAFFIC_SOURCE_LABELS]).toBeTruthy()
    }
    expect(TRAFFIC_SOURCE_LABELS[of('https://x.com/a').source]).toBe('X / Twitter')
  })
})

describe('normaliseCampaign', () => {
  it('is the one free-text field, so it is bounded', () => {
    // `?ref=` with a kilobyte of junk in it would otherwise be a row per attempt.
    expect(normaliseCampaign('x'.repeat(200))).toHaveLength(CAMPAIGN_MAX)
    expect(normaliseCampaign('  X-Bio  ')).toBe('x-bio')
    expect(normaliseCampaign('drop table users;--')).toBe('droptableusers--')
    expect(normaliseCampaign(null)).toBe('')
    expect(normaliseCampaign('')).toBe('')
  })
})
