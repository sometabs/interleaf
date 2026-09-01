import type { Database } from 'better-sqlite3'

import type { NewNote, Note, NoteKind, NotePatch } from '../../shared/api'
import { asNoteTag } from '../../shared/noteTags'
import { toPlainText } from '../../shared/plaintext'
import { deriveTitle } from '../lib/markdown'

interface NoteRow {
  id: number
  book_id: number | null
  kind: Note['kind']
  title: string
  body_md: string
  tag: string | null
  created_at: number
  updated_at: number
}

function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    bookId: row.book_id,
    kind: row.kind,
    title: row.title,
    bodyMd: row.body_md,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tag: row.tag
  }
}

export function listNotes(db: Database, bookId?: number | null): Note[] {
  const rows =
    bookId === undefined
      ? db.prepare<[], NoteRow>('SELECT * FROM note ORDER BY updated_at DESC').all()
      : bookId === null
        ? db
            .prepare<[], NoteRow>(
              'SELECT * FROM note WHERE book_id IS NULL ORDER BY updated_at DESC'
            )
            .all()
        : db
            .prepare<[number], NoteRow>(
              'SELECT * FROM note WHERE book_id = ? ORDER BY updated_at DESC'
            )
            .all(bookId)

  return rows.map(toNote)
}

export function getNote(db: Database, id: number): Note | null {
  const row = db.prepare<[number], NoteRow>('SELECT * FROM note WHERE id = ?').get(id)
  return row ? toNote(row) : null
}

// A quote is a passage from a book, so it cannot exist without one. Notes can.
function assertQuoteHasBook(kind: NoteKind | undefined, bookId: number | null): void {
  if (kind === 'highlight' && bookId === null) {
    throw new Error('A quote has to belong to a book.')
  }
}

export function createNote(db: Database, input: NewNote): Note {
  const run = db.transaction((data: NewNote): number => {
    assertQuoteHasBook(data.kind, data.bookId ?? null)
    const bodyMd = data.bodyMd ?? ''
    const title = data.title?.trim() || deriveTitle(bodyMd)

    // coalesce rather than two statements: the column is NOT NULL, and its
    // default is only applied when the column is left out entirely.
    const info = db
      .prepare(
        `INSERT INTO note (book_id, kind, title, body_md, tag, created_at, updated_at)
         VALUES (@bookId, @kind, @title, @bodyMd, @tag,
                 coalesce(@createdAt, unixepoch()), coalesce(@createdAt, unixepoch()))`
      )
      .run({
        bookId: data.bookId ?? null,
        kind: data.kind ?? 'thought',
        title,
        bodyMd,
        tag: asNoteTag(data.tag),
        createdAt: data.createdAt ?? null
      })

    return Number(info.lastInsertRowid)
  })

  let id: number
  try {
    id = run(input)
  } catch (err) {
    throw translateConstraint(err, input.kind ?? 'thought')
  }

  const created = getNote(db, id)
  if (!created) throw new Error('Insert succeeded but the note could not be read back')
  return created
}

export function updateNote(db: Database, id: number, patch: NotePatch): Note | null {
  const existing = db.prepare<[number], NoteRow>('SELECT * FROM note WHERE id = ?').get(id)
  if (!existing) return null

  const run = db.transaction((data: NotePatch): void => {
    const bodyMd = data.bodyMd ?? existing.body_md

    // A derived title tracks the body, a typed one must not. Told apart by
    // asking whether the current title is what the old body would produce.
    const previous = deriveTitle(existing.body_md)
    const wasAutoDerived =
      existing.title === '' ||
      existing.title === previous ||
      toPlainText(existing.title) === previous

    const title =
      data.title !== undefined
        ? data.title.trim()
        : data.bodyMd !== undefined && wasAutoDerived
          ? deriveTitle(bodyMd)
          : existing.title

    db.prepare(
      `UPDATE note
       SET book_id = @bookId, kind = @kind, title = @title, body_md = @bodyMd,
           tag = @tag, updated_at = unixepoch()
       WHERE id = @id`
    ).run({
      id,
      bookId: data.bookId !== undefined ? data.bookId : existing.book_id,
      kind: data.kind ?? existing.kind,
      title,
      bodyMd,
      tag: data.tag !== undefined ? asNoteTag(data.tag) : existing.tag
    })
  })

  try {
    run(patch)
  } catch (err) {
    throw translateConstraint(err, patch.kind ?? existing.kind)
  }

  return getNote(db, id)
}

export function deleteNote(db: Database, id: number): void {
  db.prepare('DELETE FROM note WHERE id = ?').run(id)
}

/** Turns the one-review-per-book constraint into something the UI can show. */
function translateConstraint(err: unknown, kind: Note['kind']): Error {
  const message = (err as Error)?.message ?? ''
  // SQLite names the column, not the partial index.
  if (kind === 'review' && /UNIQUE constraint failed: note\.book_id/.test(message)) {
    return new Error('This book already has a review. Edit the existing one instead.')
  }
  return err as Error
}
