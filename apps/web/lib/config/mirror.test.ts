import { beforeEach, describe, expect, it } from 'vitest'
import { cdnBase, configMirror, setConfigMirror } from './mirror'

/**
 * The mirror is the one piece of the credentials system that is read synchronously, from
 * inside image-URL helpers all over the render tree. Its contract is narrow but load-bearing:
 * always return something usable, never throw, never block.
 */
describe('the config mirror', () => {
  beforeEach(() => {
    setConfigMirror({ driver: 's3', cdnUrl: 'https://cdn.palscans.org/' })
  })

  it('strips trailing slashes so callers can join with one', () => {
    // Every consumer was doing `.replace(/\/+$/, '')` itself; getting this wrong produces
    // `https://cdn.example.com//pages/x`, which some CDNs treat as a different object.
    expect(cdnBase()).toBe('https://cdn.palscans.org')
    setConfigMirror({ driver: 's3', cdnUrl: 'https://cdn.palscans.org///' })
    expect(cdnBase()).toBe('https://cdn.palscans.org')
  })

  it('survives an empty CDN URL rather than throwing', () => {
    setConfigMirror({ driver: 'fs', cdnUrl: '' })
    expect(cdnBase()).toBe('')
    expect(configMirror().driver).toBe('fs')
  })

  it('reflects a write immediately', () => {
    setConfigMirror({ driver: 'fs', cdnUrl: '/_storage' })
    expect(configMirror()).toEqual({ driver: 'fs', cdnUrl: '/_storage' })
  })
})
