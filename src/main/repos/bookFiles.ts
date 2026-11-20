import type { Database } from 'better-sqlite3'

import type { BookFile, ReadingPosition } from '../../shared/api'

interface BookFileRow {
  book_id: number
  sha256: string
  file_name: string
  size: number
  added_at: number
}

const toBookFile = (row: BookFileRow): BookFile => ({
  bookId: row.book_id,
  fileName: row.file_name,
  size: row.size,
  addedAt: row.added_at
})

export function listBookFiles(db: Database): BookFile[] {
  return db
    .prepare<[], BookFileRow>('SELECT * FROM book_file ORDER BY book_id')
    .all()
    .map(toBookFile)
}

export function bookFileHash(db: Database, bookId: number): string | null {
  return (
    db
      .prepare<[number], { sha256: string }>('SELECT sha256 FROM book_file WHERE book_id = ?')
      .get(bookId)?.sha256 ?? null
  )
}

export function bookHoldingFile(db: Database, sha256: string): number | null {
  return (
    db
      .prepare<[string], { book_id: number }>('SELECT book_id FROM book_file WHERE sha256 = ?')
      .get(sha256)?.book_id ?? null
  )
}

// A replaced file starts from the beginning: a position only makes sense in its own file.
export function setBookFile(
  db: Database,
  bookId: number,
  file: { sha256: string; fileName: string; size: number }
): void {
  db.transaction(() => {
    db.prepare('DELETE FROM book_file WHERE book_id = ?').run(bookId)
    db.prepare('INSERT INTO book_file (book_id, sha256, file_name, size) VALUES (?, ?, ?, ?)').run(
      bookId,
      file.sha256,
      file.fileName,
      file.size
    )
  })()
}

export function removeBookFile(db: Database, bookId: number): void {
  db.prepare('DELETE FROM book_file WHERE book_id = ?').run(bookId)
}

export function storedEpubNames(db: Database): Set<string> {
  const rows = db.prepare<[], { sha256: string }>('SELECT sha256 FROM book_file').all()
  return new Set(rows.map((row) => `${row.sha256}.epub`))
}

export function getReadingPosition(db: Database, bookId: number): ReadingPosition | null {
  return (
    db
      .prepare<[number], ReadingPosition>(
        'SELECT cfi, fraction FROM reading_position WHERE book_id = ?'
      )
      .get(bookId) ?? null
  )
}

export function saveReadingPosition(db: Database, bookId: number, position: ReadingPosition): void {
  if (typeof position.cfi !== 'string' || position.cfi === '') throw new Error('Invalid position.')
  const fraction = Math.min(1, Math.max(0, Number(position.fraction) || 0))
  db.prepare(
    `INSERT INTO reading_position (book_id, cfi, fraction) VALUES (?, ?, ?)
      ON CONFLICT (book_id) DO UPDATE
      SET cfi = excluded.cfi, fraction = excluded.fraction, updated_at = unixepoch()`
  ).run(bookId, position.cfi, fraction)
}
