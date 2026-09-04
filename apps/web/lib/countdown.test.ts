import { describe, expect, it } from 'vitest'
import { countdownSeconds } from './countdown'

const now = new Date('2026-09-04T12:00:00Z')
const nowMs = now.getTime()
const inSec = (s: number) => new Date(nowMs + s * 1000)

describe('countdownSeconds', () => {
  it('counts the early-access window in minutes and seconds', () => {
    expect(countdownSeconds(inSec(600), nowMs)).toBe('10:00')
    expect(countdownSeconds(inSec(598), nowMs)).toBe('9:58')
    // The case core's countdown() gets wrong: the last minute must keep moving.
    expect(countdownSeconds(inSec(59), nowMs)).toBe('0:59')
    expect(countdownSeconds(inSec(9), nowMs)).toBe('0:09')
    expect(countdownSeconds(inSec(1), nowMs)).toBe('0:01')
  })

  it('never runs past zero', () => {
    expect(countdownSeconds(inSec(0), nowMs)).toBe('0:00')
    expect(countdownSeconds(inSec(-3600), nowMs)).toBe('0:00')
  })

  it('drops to coarser units for a longer wait', () => {
    expect(countdownSeconds(inSec(3600), nowMs)).toBe('1h')
    expect(countdownSeconds(inSec(3600 + 12 * 60), nowMs)).toBe('1h 12m')
    expect(countdownSeconds(inSec(2 * 86400), nowMs)).toBe('2d')
    expect(countdownSeconds(inSec(2 * 86400 + 4 * 3600), nowMs)).toBe('2d 4h')
  })

  it('takes a Date, an ISO string or epoch millis alike', () => {
    const until = inSec(125)
    expect(countdownSeconds(until, nowMs)).toBe('2:05')
    expect(countdownSeconds(until.toISOString(), nowMs)).toBe('2:05')
    expect(countdownSeconds(until.getTime(), nowMs)).toBe('2:05')
  })
})
