import { describe, expect, it } from 'vitest'
import { bareAddress, isLocalHost } from './smtp'

/**
 * The SMTP client is hand-written, so the address helpers are the boundary between operator
 * input and a line-oriented protocol. These are regression tests for a real injection: the
 * original `[^>]+` matched CR and LF, so a stored From address could append its own commands
 * to every message the site sent.
 */
describe('bareAddress', () => {
  it('extracts the address from a display-name form', () => {
    expect(bareAddress('PALScans <no-reply@palscans.org>')).toBe('no-reply@palscans.org')
    expect(bareAddress('  plain@example.org  ')).toBe('plain@example.org')
  })

  it('strips CR and LF so an extra command cannot be appended', () => {
    // Previously produced: MAIL FROM:<ok@example.org\r\nRCPT TO:<evil@attacker.test>>
    const injected = 'X <ok@example.org\r\nRCPT TO:<evil@attacker.test>'
    const out = bareAddress(injected)
    expect(out).not.toMatch(/[\r\n]/)
    expect(out).not.toContain('RCPT TO')
  })

  it('strips angle brackets so the envelope cannot be closed early', () => {
    expect(bareAddress('a@b.co>\r\nDATA')).not.toMatch(/[<>\r\n]/)
  })

  it('leaves nothing that could start a new SMTP line', () => {
    for (const probe of [
      'a@b.co\nQUIT',
      'a@b.co\r\n.\r\nMAIL FROM:<x@y.z>',
      '<a@b.co\r\nBCC: x@y.z>',
    ])
      expect(bareAddress(probe)).not.toMatch(/[\r\n<>]/)
  })
})

describe('isLocalHost', () => {
  it('recognises only the machine itself', () => {
    // This decides whether credentials may cross an unencrypted link, so it must not be loose.
    expect(isLocalHost('localhost')).toBe(true)
    expect(isLocalHost('127.0.0.1')).toBe(true)
    expect(isLocalHost('::1')).toBe(true)
    expect(isLocalHost('localhost.attacker.tld')).toBe(false)
    expect(isLocalHost('127.0.0.1.attacker.tld')).toBe(false)
    expect(isLocalHost('mail.example.org')).toBe(false)
  })
})
