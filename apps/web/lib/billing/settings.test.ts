import { describe, expect, it } from 'vitest'
import { billingKeyStatus, parseEnv } from '../env'
import { DEFAULT_PLAN_FEATURES, isPlaceholderPrice, isSellable, planFeatures } from './plans'
import { DEFAULT_BILLING_SETTINGS, parseBillingSettings } from './settings'

describe('billing settings', () => {
  it('falls back to the documented defaults', () => {
    expect(parseBillingSettings({})).toEqual(DEFAULT_BILLING_SETTINGS)
    expect(DEFAULT_BILLING_SETTINGS.graceDays).toBe(3)
    expect(DEFAULT_BILLING_SETTINGS.taxEnabled).toBe(true)
  })

  it('keeps the fields it can read and defaults the rest of a half-written value', () => {
    const parsed = parseBillingSettings({ graceDays: 7, taxEnabled: 'nonsense', unknown: 1 })
    expect(parsed.graceDays).toBe(7)
    expect(parsed.taxEnabled).toBe(true)
    expect(parsed.portalEnabled).toBe(true)
  })

  it('refuses an out-of-range grace window', () => {
    expect(parseBillingSettings({ graceDays: 400 }).graceDays).toBe(3)
    expect(parseBillingSettings({ graceDays: 0 }).graceDays).toBe(0)
  })

  it('trims the statement descriptor to what a card statement can hold', () => {
    expect(parseBillingSettings({ statementDescriptor: 'PALSCANS' }).statementDescriptor).toBe(
      'PALSCANS',
    )
    // 23 characters: rejected, so the default stands.
    expect(parseBillingSettings({ statementDescriptor: 'X'.repeat(23) }).statementDescriptor).toBe(
      'PALSCANS',
    )
  })
})

describe('plans', () => {
  it('falls back to the shipped feature set for an un-migrated row', () => {
    expect(planFeatures({ id: 'premium', features: [] })).toEqual(DEFAULT_PLAN_FEATURES.premium)
    expect(planFeatures({ id: 'supporter', features: null })).toEqual(['no_ads'])
    expect(planFeatures({ id: 'mystery', features: [] })).toEqual([])
    expect(planFeatures({ id: 'premium', features: ['no_ads'] })).toEqual(['no_ads'])
  })

  it('never sells a seeded placeholder price', () => {
    expect(isPlaceholderPrice('price_dev_premium')).toBe(true)
    expect(isPlaceholderPrice('price_1MowQULkdIwHu7ixraBm864M')).toBe(false)
    const plan = {
      id: 'premium',
      name: 'Premium',
      priceCents: 500,
      interval: 'month',
      stripePriceId: 'price_dev_premium',
      features: ['no_ads'],
      active: true,
    }
    expect(isSellable(plan)).toBe(false)
    expect(isSellable({ ...plan, stripePriceId: 'price_live_1' })).toBe(true)
    expect(isSellable({ ...plan, stripePriceId: 'price_live_1', active: false })).toBe(false)
  })
})

describe('billing feature detection', () => {
  const env = (over: Record<string, string>) => parseEnv({ NODE_ENV: 'development', ...over })

  it('needs both keys before anything billing-related is live', () => {
    expect(billingKeyStatus(env({}))).toEqual({
      secretKey: false,
      webhookSecret: false,
      configured: false,
    })
    expect(billingKeyStatus(env({ STRIPE_SECRET_KEY: 'sk_test_1' }))).toEqual({
      secretKey: true,
      webhookSecret: false,
      configured: false,
    })
    expect(
      billingKeyStatus(env({ STRIPE_SECRET_KEY: 'sk_test_1', STRIPE_WEBHOOK_SECRET: 'whsec_1' })),
    ).toEqual({ secretKey: true, webhookSecret: true, configured: true })
  })

  it('treats an empty string in a .env file as unset', () => {
    expect(
      billingKeyStatus(env({ STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '' })).configured,
    ).toBe(false)
  })
})
