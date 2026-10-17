import { describe, expect, it, vi } from 'vitest'

/**
 * `/api/health` is what the container health check and every uptime monitor believe.
 *
 * It was shallow in a way that let a total outage read as healthy: with an invalid
 * environment — a single missing variable — `getEnv()` throws inside every page render, so
 * the site answers 500 everywhere, while this endpoint touched only the database and
 * answered `{"status":"ok"}`. Docker never restarted the container and no monitor fired.
 *
 * So the contract asserted here is: it is green only when this process can actually serve a
 * page, which means the environment parses *and* the database answers.
 */

const state = vi.hoisted(() => ({ envThrows: false, dbThrows: false }))

vi.mock('@/lib/env', () => ({
  getEnv: () => {
    if (state.envThrows) throw new Error('Invalid environment:\n  TRUSTED_PROXY: must be …')
    return { SITE_URL: 'http://localhost:3000' }
  },
}))

vi.mock('@palscans/db', () => ({
  getDb: async () => ({
    execute: async () => {
      if (state.dbThrows) throw new Error('connection refused')
      return []
    },
  }),
}))

const { GET } = await import('./route')

const call = async () => {
  const response = await GET()
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

describe('GET /api/health', () => {
  it('is green when the environment parses and the database answers', async () => {
    state.envThrows = false
    state.dbThrows = false
    const { status, body } = await call()
    expect(status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.db).toBe('up')
  })

  it('is red when the environment will not parse, which is a site that serves nothing', async () => {
    state.envThrows = true
    state.dbThrows = false
    const { status, body } = await call()
    expect(status).toBe(503)
    expect(body.status).toBe('degraded')
    expect(body.env).toBe('bad')
  })

  it('does not leak which variable is wrong — the response is public', async () => {
    state.envThrows = true
    state.dbThrows = false
    const { body } = await call()
    expect(JSON.stringify(body)).not.toContain('TRUSTED_PROXY')
  })

  it('is red when the database will not answer', async () => {
    state.envThrows = false
    state.dbThrows = true
    const { status, body } = await call()
    expect(status).toBe(503)
    expect(body.db).toBe('down')
  })
})
