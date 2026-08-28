import type { Database } from 'better-sqlite3'

// None of it is undoable; the vault export is the only safety net.

export interface DataCounts {
  books: number
  notes: number
  candidates: number
  dismissed: number
}

export function dataCounts(db: Database): DataCounts {
  const count = (sql: string): number =>
    db.prepare<[], { n: number }>(`SELECT count(*) AS n FROM ${sql}`).get()!.n

  return {
    books: count('book'),
    notes: count('note'),
    candidates: count('book_candidate'),
    dismissed: count("rec_feedback WHERE action = 'dismissed'")
  }
}

// The cascade needs `foreign_keys` on, which `createDatabase` sets: SQLite
// ignores that pragma inside a transaction, so it cannot be set here.
export function deleteAllBooks(db: Database): number {
  return db.transaction(() => {
    const { n } = db.prepare<[], { n: number }>('SELECT count(*) AS n FROM book').get()!
    db.prepare('DELETE FROM book').run()
    return n
  })()
}

/** Deletes every note, attached or free-floating. Books are untouched. */
export function deleteAllNotes(db: Database): number {
  return db.transaction(() => {
    const { n } = db.prepare<[], { n: number }>('SELECT count(*) AS n FROM note').get()!
    db.prepare('DELETE FROM note').run()
    return n
  })()
}

// The schema and `user_version` stay, so the result is an empty database
// rather than an un-migrated one.
export function deleteEverything(db: Database): void {
  db.transaction(() => {
    db.prepare('DELETE FROM note').run()
    db.prepare('DELETE FROM book').run()
    db.prepare('DELETE FROM book_candidate').run()
    db.prepare('DELETE FROM rec_feedback').run()
  })()
}
