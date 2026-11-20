import type { Database } from 'better-sqlite3'

import type { BookReadingTime, ReadingTimeSummary } from '../../shared/api'

const DAY = 86400
const WEEKS_SHOWN = 12
const TOP_BOOKS = 3
// Shorter visits are opening a book to look something up, not reading it.
const SESSION_MINIMUM = 60

// A session is saved again as it grows, so the same start only ever moves forward.
export function recordSession(
  db: Database,
  bookId: number,
  startedAt: number,
  seconds: number
): void {
  if (!Number.isInteger(startedAt) || startedAt <= 0) throw new Error('Invalid session.')
  if (!Number.isInteger(seconds) || seconds <= 0 || seconds > DAY) {
    throw new Error('Invalid session.')
  }
  db.prepare(
    `INSERT INTO reading_session (book_id, started_at, seconds) VALUES (?, ?, ?)
      ON CONFLICT (book_id, started_at) DO UPDATE SET seconds = max(seconds, excluded.seconds)`
  ).run(bookId, startedAt, seconds)
}

export function bookReadingTime(db: Database, bookId: number): BookReadingTime {
  const row = db
    .prepare<[number], { seconds: number | null; sessions: number }>(
      `SELECT sum(seconds) AS seconds, count(*) AS sessions
         FROM reading_session WHERE book_id = ?`
    )
    .get(bookId)
  return { seconds: row?.seconds ?? 0, sessions: row?.sessions ?? 0 }
}

const unix = (date: Date): number => Math.floor(date.getTime() / 1000)

// Weeks start on Monday, in local time, like the calendar on the wall.
function weekStart(now: Date): Date {
  const daysSinceMonday = (now.getDay() + 6) % 7
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday)
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

export function readingTimeSummary(db: Database, now = new Date()): ReadingTimeSummary {
  const yearStart = unix(new Date(now.getFullYear(), 0, 1))
  const thisWeek = weekStart(now)
  const weekStarts = Array.from({ length: WEEKS_SHOWN }, (_, index) =>
    unix(
      new Date(
        thisWeek.getFullYear(),
        thisWeek.getMonth(),
        thisWeek.getDate() - 7 * (WEEKS_SHOWN - 1 - index)
      )
    )
  )
  const from = Math.min(yearStart, weekStarts[0], unix(now) - 365 * DAY)
  const rows = db
    .prepare<[number], { book_id: number; started_at: number; seconds: number }>(
      'SELECT book_id, started_at, seconds FROM reading_session WHERE started_at >= ?'
    )
    .all(from)

  const weeks = weekStarts.map((start) => ({ start, seconds: 0 }))
  const byBook = new Map<number, number>()
  let yearSeconds = 0
  for (const row of rows) {
    if (row.started_at >= yearStart) {
      yearSeconds += row.seconds
      byBook.set(row.book_id, (byBook.get(row.book_id) ?? 0) + row.seconds)
    }
    for (let index = weeks.length - 1; index >= 0; index--) {
      if (row.started_at >= weeks[index].start) {
        weeks[index].seconds += row.seconds
        break
      }
    }
  }

  const title = db.prepare<[number], { title: string }>('SELECT title FROM book WHERE id = ?')
  const topBooks = [...byBook]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_BOOKS)
    .map(([bookId, seconds]) => ({ bookId, title: title.get(bookId)?.title ?? '', seconds }))

  const anySessions =
    db
      .prepare<[], { found: number }>('SELECT EXISTS (SELECT 1 FROM reading_session) AS found')
      .get()?.found === 1

  return {
    anySessions,
    yearSeconds,
    weekSeconds: weeks[weeks.length - 1].seconds,
    usualSessionSeconds: median(
      rows
        .filter((row) => row.started_at >= unix(now) - 365 * DAY)
        .map((row) => row.seconds)
        .filter((seconds) => seconds >= SESSION_MINIMUM)
    ),
    weeks,
    topBooks
  }
}
