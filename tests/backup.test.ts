import Database from 'better-sqlite3'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDatabase, MIGRATIONS } from '../src/main/db/database'
import * as books from '../src/main/repos/books'
import * as notes from '../src/main/repos/notes'
import {
  BackupError,
  exportBackup,
  resolveBackupRoot,
  restoreBackup
} from '../src/main/services/backup'

let parent: string
let live: string

beforeEach(() => {
  parent = mkdtempSync(join(tmpdir(), 'interleaf-backup-'))
  live = join(parent, 'library', 'interleaf.db')
  mkdirSync(join(parent, 'library'), { recursive: true })
})

afterEach(() => {
  rmSync(parent, { recursive: true, force: true })
})

function seed(): Database.Database {
  const db = createDatabase(live)
  const book = books.createBook(db, { title: 'Dark Matter', author: 'Blake Crouch' })
  books.updateBook(db, book.id, { rating: 5, status: 'read', olid: 'OL1W' })
  notes.createNote(db, {
    bookId: book.id,
    kind: 'highlight',
    bodyMd: 'Every moment branches.',
    createdAt: Math.floor(Date.parse('2026-03-01T00:00:00Z') / 1000)
  })
  db.prepare("INSERT INTO rec_feedback (olid, action) VALUES ('OL9W', 'dismissed')").run()
  return db
}

describe('writing a backup', () => {
  it('keeps everything the Markdown vault drops', () => {
    const db = seed()
    const { dir } = exportBackup(db, parent)
    db.close()

    const copy = new Database(join(dir, 'interleaf.db'), { readonly: true })
    try {
      const book = copy
        .prepare<[], { rating: number; status: string; olid: string }>(
          'SELECT rating, status, olid FROM book'
        )
        .get()
      expect(book).toEqual({ rating: 5, status: 'read', olid: 'OL1W' })

      const note = copy.prepare<[], { created_at: number }>('SELECT created_at FROM note').get()
      expect(new Date((note?.created_at ?? 0) * 1000).toISOString().slice(0, 10)).toBe('2026-03-01')

      const refused = copy
        .prepare<[], { n: number }>('SELECT count(*) AS n FROM rec_feedback')
        .get()
      expect(refused?.n).toBe(1)
    } finally {
      copy.close()
    }
  })

  it('includes writes still sitting in the write-ahead log', () => {
    const db = seed()
    // No checkpoint: a plain file copy of `live` would be missing this book.
    books.createBook(db, { title: 'Recursion' })

    const { dir } = exportBackup(db, parent)
    db.close()

    const copy = new Database(join(dir, 'interleaf.db'), { readonly: true })
    const titles = copy.prepare<[], { title: string }>('SELECT title FROM book').all()
    copy.close()
    expect(titles.map((t) => t.title).sort()).toEqual(['Dark Matter', 'Recursion'])
  })

  it('carries the covers, which live outside the database', () => {
    const cache = join(parent, 'cache')
    mkdirSync(cache, { recursive: true })
    writeFileSync(join(cache, 'book-1-99.jpg'), 'JPEGBYTES')

    const db = seed()
    books.updateBook(db, books.listBooks(db)[0].id, { coverPath: 'book-1-99.jpg' })
    const result = exportBackup(db, parent, cache)
    db.close()

    expect(result.covers).toBe(1)
    expect(readFileSync(join(result.dir, 'covers', 'book-1-99.jpg'), 'utf8')).toBe('JPEGBYTES')
  })

  it('writes the readable copy alongside the database', () => {
    const db = seed()
    const { dir, files } = exportBackup(db, parent)
    db.close()

    expect(files).toBe(1)
    expect(existsSync(join(dir, 'markdown', 'books', 'dark-matter.md'))).toBe(true)
    expect(readFileSync(join(dir, 'markdown', 'books', 'dark-matter.md'), 'utf8')).toContain(
      'rating: 5'
    )
  })

  it('leaves the Discover thumbnail cache behind', () => {
    const cache = join(parent, 'cache')
    mkdirSync(cache, { recursive: true })
    writeFileSync(join(cache, 'book-1-99.jpg'), 'IN USE')
    writeFileSync(join(cache, 'book-404-7.jpg'), 'ORPHANED')
    writeFileSync(join(cache, 'cover-12345.jpg'), 'A BOOK NOBODY OWNS')

    const db = seed()
    books.updateBook(db, books.listBooks(db)[0].id, { coverPath: 'book-1-99.jpg' })
    const result = exportBackup(db, parent, cache)
    db.close()

    expect(result.covers).toBe(1)
    expect(existsSync(join(result.dir, 'covers', 'book-1-99.jpg'))).toBe(true)
    expect(existsSync(join(result.dir, 'covers', 'book-404-7.jpg'))).toBe(false)
    expect(existsSync(join(result.dir, 'covers', 'cover-12345.jpg'))).toBe(false)
  })

  it('replaces the previous backup rather than refusing to overwrite it', () => {
    const db = seed()
    exportBackup(db, parent)
    books.createBook(db, { title: 'Upgrade' })
    const { books: counted } = exportBackup(db, parent)
    db.close()

    expect(counted).toBe(2)
  })
})

describe('finding a backup', () => {
  it('accepts the backup folder, or the folder it was written into', () => {
    const db = seed()
    const { dir } = exportBackup(db, parent)
    db.close()

    expect(resolveBackupRoot(dir)).toBe(dir)
    expect(resolveBackupRoot(parent)).toBe(dir)
  })

  it('is null for a folder holding no library', () => {
    expect(resolveBackupRoot(join(parent, 'library'))).toBeNull()
  })
})

describe('restoring a backup', () => {
  it('puts the library back, with its ratings and its dates', () => {
    const db = seed()
    const { dir } = exportBackup(db, parent)
    db.close()

    // Whatever is there now is not what the backup holds.
    rmSync(live, { force: true })
    const other = createDatabase(live)
    books.createBook(other, { title: 'Something else' })
    other.close()

    const result = restoreBackup(dir, live)
    expect(result.books).toBe(1)

    const restored = createDatabase(live)
    try {
      expect(books.listBooks(restored)[0]).toMatchObject({ title: 'Dark Matter', rating: 5 })
      expect(notes.listNotes(restored, books.listBooks(restored)[0].id)[0].bodyMd).toContain(
        'Every moment branches'
      )
    } finally {
      restored.close()
    }
  })

  it('keeps a copy of the library it replaced', () => {
    const db = seed()
    const { dir } = exportBackup(db, parent)
    db.close()

    const result = restoreBackup(dir, live)

    expect(result.replaced).not.toBeNull()
    expect(existsSync(result.replaced as string)).toBe(true)
  })

  it('keeps only the newest copy, not one per restore', () => {
    const db = seed()
    const { dir } = exportBackup(db, parent)
    db.close()

    const first = restoreBackup(dir, live)
    const second = restoreBackup(dir, live)

    expect(existsSync(second.replaced as string)).toBe(true)
    expect(existsSync(first.replaced as string)).toBe(false)

    const copies = readdirSync(join(parent, 'library')).filter((n) => n.endsWith('.bak'))
    expect(copies).toHaveLength(1)
  })

  it('touches nothing but its own copies', () => {
    const db = seed()
    const { dir } = exportBackup(db, parent)
    db.close()

    // Whatever else lives in the app folder is not ours to delete.
    const stranger = join(parent, 'library', 'something-else.bak')
    writeFileSync(stranger, 'NOT OURS')

    restoreBackup(dir, live)

    expect(existsSync(stranger)).toBe(true)
  })

  it('refuses a folder with no library in it', () => {
    const empty = join(parent, 'empty')
    mkdirSync(empty, { recursive: true })

    expect(() => restoreBackup(empty, live)).toThrow(BackupError)
  })

  it('refuses a file that is not an Interleaf library', () => {
    const stranger = join(parent, 'stranger')
    mkdirSync(stranger, { recursive: true })
    const db = new Database(join(stranger, 'interleaf.db'))
    db.exec('CREATE TABLE something (x)')
    db.close()

    expect(() => restoreBackup(stranger, live)).toThrow(/not an Interleaf library/)
  })

  it('refuses a backup from a newer version, rather than downgrading it', () => {
    const db = seed()
    const { dir } = exportBackup(db, parent)
    db.close()

    const newer = new Database(join(dir, 'interleaf.db'))
    newer.pragma(`user_version = ${MIGRATIONS.length + 1}`)
    newer.close()

    expect(() => restoreBackup(dir, live)).toThrow(/newer version/)
  })

  it('leaves the library alone when it refuses', () => {
    const db = seed()
    db.close()
    const empty = join(parent, 'empty')
    mkdirSync(empty, { recursive: true })

    expect(() => restoreBackup(empty, live)).toThrow(BackupError)

    const untouched = createDatabase(live)
    try {
      expect(books.listBooks(untouched)).toHaveLength(1)
    } finally {
      untouched.close()
    }
  })
})
