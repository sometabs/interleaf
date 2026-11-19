import type { Database } from 'better-sqlite3'

import type { ReadingGoal } from '../../shared/api'

export function listReadingGoals(db: Database): ReadingGoal[] {
  return db.prepare<[], ReadingGoal>('SELECT year, books FROM reading_goal ORDER BY year').all()
}

// No goal is stored as no row, so clearing one leaves nothing behind.
export function setReadingGoal(db: Database, year: number, books: number | null): void {
  if (!Number.isInteger(year)) throw new Error('Invalid goal year.')
  if (books === null) {
    db.prepare('DELETE FROM reading_goal WHERE year = ?').run(year)
    return
  }
  if (!Number.isInteger(books) || books < 1)
    throw new Error('A goal must be a whole number of books.')
  db.prepare(
    `INSERT INTO reading_goal (year, books) VALUES (?, ?)
      ON CONFLICT (year) DO UPDATE SET books = excluded.books
      WHERE reading_goal.books <> excluded.books`
  ).run(year, books)
}
