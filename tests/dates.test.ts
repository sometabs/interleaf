import { afterEach, describe, expect, it, vi } from 'vitest'

import { readingDurationDays } from '../src/renderer/src/lib/dates'

function date(year: number, month: number, day: number, hour = 0): number {
  const value = new Date(0)
  value.setFullYear(year, month - 1, day)
  value.setHours(hour, 0, 0, 0)
  return value.getTime() / 1000
}

afterEach(() => vi.unstubAllEnvs())

describe('reading duration', () => {
  it('counts elapsed calendar days', () => {
    expect(readingDurationDays(date(2026, 11, 1), date(2026, 11, 13))).toBe(12)
  })

  it('handles the same day, one day, leap days and a year boundary', () => {
    expect(readingDurationDays(date(2026, 1, 1, 8), date(2026, 1, 1, 22))).toBe(0)
    expect(readingDurationDays(date(2026, 1, 1, 23), date(2026, 1, 2, 1))).toBe(1)
    expect(readingDurationDays(date(2024, 2, 28), date(2024, 3, 1))).toBe(2)
    expect(readingDurationDays(date(2025, 12, 31), date(2026, 1, 1))).toBe(1)
    expect(readingDurationDays(date(99, 12, 31), date(100, 1, 1))).toBe(1)
    expect(readingDurationDays(0, 86400)).toBe(1)
  })

  it.each([
    [null, null],
    [null, 100],
    [100, null],
    [200, 100],
    [NaN, 100],
    [100, Infinity],
    [0, Number.MAX_VALUE]
  ])('hides missing, reversed or invalid dates (%s, %s)', (start, finish) => {
    expect(readingDurationDays(start, finish)).toBeNull()
  })

  it.each([
    ['America/New_York', 2026, 3, 8],
    ['America/New_York', 2026, 11, 1],
    ['Europe/Paris', 2026, 3, 29],
    ['Europe/Paris', 2026, 10, 25]
  ] as const)(
    'counts one calendar day across a daylight-saving change in %s (%s-%s-%s)',
    (zone, year, month, day) => {
      vi.stubEnv('TZ', zone)
      const start = date(year, month, day)
      const finish = date(year, month, day + 1)
      expect((finish - start) / 3600).not.toBe(24)
      expect(readingDurationDays(start, finish)).toBe(1)
    }
  )

  it('uses the displayed local dates, rather than UTC dates', () => {
    vi.stubEnv('TZ', 'America/New_York')
    const start = date(2026, 1, 1, 22)
    const finish = date(2026, 1, 2, 1)
    expect(new Date(start * 1000).getUTCDate()).toBe(new Date(finish * 1000).getUTCDate())
    expect(readingDurationDays(start, finish)).toBe(1)
  })
})
