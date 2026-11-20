import type { Database } from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from '../src/main/db/database'
import * as books from '../src/main/repos/books'
import * as time from '../src/main/repos/readingTime'
import { formatDuration, IDLE_CAP_MS, ReadingClock } from '../src/renderer/src/lib/readingClock'

let db: Database
let first: number
let second: number

// A Wednesday afternoon, local time.
const NOW = new Date(2026, 10, 18, 15, 0)
const at = (month: number, day: number, hour = 20): number =>
  Math.floor(new Date(2026, month, day, hour).getTime() / 1000)

beforeEach(() => {
  db = createDatabase(':memory:')
  first = books.createBook(db, { title: 'The Lighthouse Keeper' }).id
  second = books.createBook(db, { title: 'Salt Roads' }).id
})

describe('reading sessions', () => {
  it('keeps one row per session as it is saved again and grows', () => {
    time.recordSession(db, first, at(10, 17), 120)
    time.recordSession(db, first, at(10, 17), 900)
    time.recordSession(db, first, at(10, 17), 600)

    expect(time.bookReadingTime(db, first)).toEqual({ seconds: 900, sessions: 1 })
  })

  it('refuses times that cannot be real', () => {
    expect(() => time.recordSession(db, first, at(10, 17), 0)).toThrow('Invalid session.')
    expect(() => time.recordSession(db, first, at(10, 17), 90000)).toThrow('Invalid session.')
    expect(() => time.recordSession(db, first, -5, 60)).toThrow('Invalid session.')
    expect(() => time.recordSession(db, first, at(10, 17), 1.5)).toThrow('Invalid session.')
  })

  it('goes with the book when it is deleted', () => {
    time.recordSession(db, first, at(10, 17), 600)

    books.deleteBook(db, first)

    expect(time.bookReadingTime(db, first)).toEqual({ seconds: 0, sessions: 0 })
  })

  it('counts as a change for the automatic backup', () => {
    const revision = (): string =>
      db.prepare<[], { revision: string }>('SELECT revision FROM library_revision').get()!.revision
    const before = revision()

    time.recordSession(db, first, at(10, 17), 600)

    expect(revision()).not.toBe(before)
  })
})

describe('reading time summary', () => {
  it('says nothing has been read before the first session', () => {
    const summary = time.readingTimeSummary(db, NOW)

    expect(summary.anySessions).toBe(false)
    expect(summary.yearSeconds).toBe(0)
    expect(summary.weeks).toHaveLength(12)
    expect(summary.usualSessionSeconds).toBeNull()
  })

  it('adds up the year and the week, which starts on Monday', () => {
    time.recordSession(db, first, at(10, 16, 8), 600) // Monday this week
    time.recordSession(db, first, at(10, 15), 1200) // Sunday, last week
    time.recordSession(db, second, at(1, 3), 3000) // February
    time.recordSession(db, second, Math.floor(new Date(2025, 11, 30).getTime() / 1000), 5000)

    const summary = time.readingTimeSummary(db, NOW)

    expect(summary.anySessions).toBe(true)
    expect(summary.weekSeconds).toBe(600)
    expect(summary.weeks.at(-2)?.seconds).toBe(1200)
    expect(summary.yearSeconds).toBe(4800)
  })

  it('ranks the books read longest this year', () => {
    time.recordSession(db, first, at(10, 2), 600)
    time.recordSession(db, second, at(10, 3), 900)
    time.recordSession(db, first, at(10, 4), 600)

    expect(time.readingTimeSummary(db, NOW).topBooks).toEqual([
      { bookId: first, title: 'The Lighthouse Keeper', seconds: 1200 },
      { bookId: second, title: 'Salt Roads', seconds: 900 }
    ])
  })

  it('gives the usual session from real sessions, not quick look-ups', () => {
    time.recordSession(db, first, at(10, 2), 30)
    time.recordSession(db, first, at(10, 3), 600)
    time.recordSession(db, first, at(10, 4), 1800)
    time.recordSession(db, first, at(10, 5), 2400)

    expect(time.readingTimeSummary(db, NOW).usualSessionSeconds).toBe(1800)
  })
})

describe('reading clock', () => {
  it('counts the time between signs of reading', () => {
    const clock = new ReadingClock(0)
    clock.activity(40_000)
    clock.activity(100_000)

    expect(clock.seconds).toBe(100)
  })

  // Walking away with the book open counts only the first few minutes of the pause.
  it('caps a long pause', () => {
    const clock = new ReadingClock(0)
    clock.activity(60 * 60_000)

    expect(clock.seconds).toBe(IDLE_CAP_MS / 1000)
  })

  it('ignores the time the window is hidden', () => {
    const clock = new ReadingClock(0)
    clock.pause(30_000)
    clock.resume(10 * 60_000)
    clock.activity(10 * 60_000 + 20_000)

    expect(clock.seconds).toBe(50)
  })
})

describe('durations', () => {
  it('reads like a person would say it', () => {
    expect(formatDuration(20)).toBe('under a minute')
    expect(formatDuration(35 * 60)).toBe('35 min')
    expect(formatDuration(3 * 3600 + 40 * 60)).toBe('3 h 40 min')
    expect(formatDuration(2 * 3600)).toBe('2 h')
    expect(formatDuration(48 * 3600 + 20 * 60)).toBe('48 h')
  })
})
