import type Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from '../src/main/db/database'
import * as data from '../src/main/repos/data'
import { listReadingGoals, setReadingGoal } from '../src/main/repos/goals'

let db: Database.Database

beforeEach(() => {
  db = createDatabase(':memory:')
})

const revision = (): string =>
  db.prepare<[], { revision: string }>('SELECT revision FROM library_revision').get()!.revision

describe('reading goals', () => {
  it('keeps one goal per year', () => {
    setReadingGoal(db, 2025, 20)
    setReadingGoal(db, 2026, 24)
    setReadingGoal(db, 2026, 30)

    expect(listReadingGoals(db)).toEqual([
      { year: 2025, books: 20 },
      { year: 2026, books: 30 }
    ])
  })

  it('removes a goal set to null', () => {
    setReadingGoal(db, 2026, 24)
    setReadingGoal(db, 2026, null)

    expect(listReadingGoals(db)).toEqual([])
  })

  it('refuses a goal that is not a whole number of books', () => {
    expect(() => setReadingGoal(db, 2026, 0)).toThrow()
    expect(() => setReadingGoal(db, 2026, 2.5)).toThrow()
    expect(listReadingGoals(db)).toEqual([])
  })

  // Automatic backups only run when the library revision changes.
  it('marks the library as changed for backups', () => {
    const before = revision()
    setReadingGoal(db, 2026, 24)
    expect(revision()).not.toBe(before)
  })

  it('is cleared with everything else', () => {
    setReadingGoal(db, 2026, 24)
    data.deleteEverything(db)
    expect(listReadingGoals(db)).toEqual([])
  })
})
