import Database from 'better-sqlite3'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDatabase, MIGRATIONS } from '../src/main/db/database'
import * as books from '../src/main/repos/books'
import { getBookshelfLayout, saveBookshelfLayout } from '../src/main/repos/bookshelf'
import { getReaderLook, saveReaderLook } from '../src/main/repos/readerLook'
import * as notes from '../src/main/repos/notes'
import { DEFAULT_LOOK } from '../src/shared/readerLook'
import {
  BackupError,
  exportBackup,
  exportMarkdown,
  resolveBackupRoot,
  restoreBackup
} from '../src/main/services/backup'

vi.mock('fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('fs')>()
  return { ...fs, renameSync: vi.fn(fs.renameSync) }
})

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

  // Markdown is its own export; a backup holds only what a restore reads.
  it('leaves the readable Markdown out of a backup', () => {
    const db = seed()
    const { dir } = exportBackup(db, parent)
    db.close()

    expect(existsSync(join(dir, 'interleaf.db'))).toBe(true)
    expect(existsSync(join(dir, 'markdown'))).toBe(false)
    expect(existsSync(join(dir, 'books'))).toBe(false)
  })

  it('exports Markdown into its own dated folder, with no database', () => {
    const db = seed()
    const { dir, files } = exportMarkdown(db, parent, undefined, new Date(2026, 10, 20, 14, 30))
    db.close()

    expect(dir).toBe(join(parent, 'interleaf-markdown-2026-11-20-1430'))
    expect(files).toBe(1)
    expect(readFileSync(join(dir, 'books', 'dark-matter.md'), 'utf8')).toContain('rating: 5')
    expect(existsSync(join(dir, 'interleaf.db'))).toBe(false)
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

  it('writes each backup into a new dated folder, keeping the earlier ones', () => {
    const db = seed()
    const at = new Date(2026, 10, 20, 14, 30)
    const first = exportBackup(db, parent, undefined, undefined, at)
    books.createBook(db, { title: 'Upgrade' })
    const second = exportBackup(db, parent, undefined, undefined, at)
    db.close()

    expect(first.dir).toBe(join(parent, 'interleaf-backup-2026-11-20-1430'))
    expect(second.dir).toBe(join(parent, 'interleaf-backup-2026-11-20-1430-2'))
    expect(second.books).toBe(2)
    expect(existsSync(join(first.dir, 'interleaf.db'))).toBe(true)
  })

  it('leaves no half-written folder when a backup fails', () => {
    const db = seed()
    const { dir } = exportBackup(db, parent)
    const before = readFileSync(join(dir, 'interleaf.db'))
    db.exec('BEGIN')
    try {
      expect(() => exportBackup(db, parent)).toThrow(BackupError)
      expect(readFileSync(join(dir, 'interleaf.db'))).toEqual(before)
      expect(readdirSync(parent).filter((name) => name.startsWith('interleaf-backup'))).toEqual([
        dir.split(/[\\/]/).pop()
      ])
    } finally {
      db.exec('ROLLBACK')
      db.close()
    }
  })

  it('keeps the previous database backup if publishing the new file fails', () => {
    const db = seed()
    const { dir } = exportBackup(db, parent)
    const before = readFileSync(join(dir, 'interleaf.db'))
    books.createBook(db, { title: 'Only in the current library' })
    vi.mocked(renameSync).mockImplementationOnce(() => {
      throw new Error('File locked')
    })
    try {
      expect(() => exportBackup(db, parent)).toThrow(/File locked/)
      expect(readFileSync(join(dir, 'interleaf.db'))).toEqual(before)
      expect(readdirSync(dir).filter((name) => name.startsWith('.pending-'))).toEqual([])
    } finally {
      db.close()
    }
  })
})

describe('finding a backup', () => {
  it('accepts a dated backup folder', () => {
    const db = seed()
    const { dir } = exportBackup(db, parent)
    db.close()

    expect(resolveBackupRoot(dir)).toBe(dir)
  })

  // Exports made before backups were dated all sat in one fixed folder.
  it('still finds a backup written before they were dated', () => {
    const legacy = join(parent, 'interleaf-backup')
    mkdirSync(legacy)
    const db = seed()
    db.prepare('VACUUM INTO ?').run(join(legacy, 'interleaf.db'))
    db.close()

    expect(resolveBackupRoot(parent)).toBe(legacy)
  })

  it('is null for a folder holding no library', () => {
    expect(resolveBackupRoot(join(parent, 'library'))).toBeNull()
  })
})

describe('restoring a backup', () => {
  it('restores named shelves, stack positions, and book display choices without a local profile', () => {
    const db = seed()
    const [first] = books.listBooks(db)
    const second = books.createBook(db, { title: 'Solaris' })
    const hidden = books.createBook(db, { title: 'Wolf Hall' })
    const layout = {
      shelves: [
        {
          id: 1,
          name: 'Favorites',
          bookIds: [first.id, second.id],
          positions: { '-1': 120 },
          stacks: [{ id: -1, bookIds: [first.id, second.id] }]
        }
      ],
      faceOutBookIds: [second.id],
      hiddenBookIds: [hidden.id]
    }
    saveBookshelfLayout(db, layout)
    const { dir } = exportBackup(db, parent)
    db.close()

    const freshDir = join(parent, 'new-profile')
    mkdirSync(freshDir)
    const freshPath = join(freshDir, 'interleaf.db')
    restoreBackup(dir, freshPath)
    const restored = createDatabase(freshPath)
    try {
      expect(getBookshelfLayout(restored)).toEqual(layout)
    } finally {
      restored.close()
    }
  })

  it('brings the reader settings to a new machine', () => {
    const db = seed()
    const look = saveReaderLook(db, { ...DEFAULT_LOOK, theme: 'sepia', size: 140, margin: 60 })
    const { dir } = exportBackup(db, parent)
    db.close()

    const freshPath = join(parent, 'new-profile', 'interleaf.db')
    mkdirSync(join(parent, 'new-profile'))
    restoreBackup(dir, freshPath)
    const restored = createDatabase(freshPath)
    try {
      expect(getReaderLook(restored)).toEqual(look)
    } finally {
      restored.close()
    }
  })

  it('upgrades a valid older backup on a copy without modifying the original backup', () => {
    const db = seed()
    db.close()
    const oldDir = join(parent, 'old-backup')
    mkdirSync(oldDir)
    const oldPath = join(oldDir, 'interleaf.db')
    const old = createDatabase(oldPath, 18)
    books.createBook(old, { title: 'From an older build', rating: 4 })
    old.close()
    const original = readFileSync(oldPath)

    restoreBackup(oldDir, live)

    const restored = createDatabase(live)
    try {
      expect(restored.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
      expect(books.listBooks(restored)[0]).toMatchObject({
        title: 'From an older build',
        rating: 4
      })
      expect(getBookshelfLayout(restored)).toEqual({
        shelves: [],
        faceOutBookIds: [],
        hiddenBookIds: []
      })
      expect(readFileSync(oldPath)).toEqual(original)
    } finally {
      restored.close()
    }
  })

  it('keeps the installed database and previous recovery copy if publishing a restore fails', () => {
    const db = seed()
    const { dir } = exportBackup(db, parent)
    books.createBook(db, { title: 'Not in the backup' })
    db.close()
    const before = readFileSync(live)
    const priorRecovery = `${live}.previous.bak`
    writeFileSync(priorRecovery, before)
    vi.mocked(renameSync).mockImplementationOnce(() => {
      throw new Error('File locked')
    })

    expect(() => restoreBackup(dir, live)).toThrow(/File locked/)
    expect(readFileSync(live)).toEqual(before)
    expect(readFileSync(priorRecovery)).toEqual(before)
    expect(
      readdirSync(join(parent, 'library')).filter((name) => name.startsWith('.restore-'))
    ).toEqual([])
  })

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

  it('checks that an older backup can be upgraded before replacing the library', () => {
    const db = seed()
    db.close()
    const oldDir = join(parent, 'broken-old-backup')
    mkdirSync(oldDir)
    const old = createDatabase(join(oldDir, 'interleaf.db'), 18)
    old.exec('DROP TABLE calibre_book')
    old.close()
    const before = readFileSync(live)

    expect(() => restoreBackup(oldDir, live)).toThrow()
    expect(readFileSync(live)).toEqual(before)
    expect(readdirSync(join(parent, 'library')).filter((name) => name.endsWith('.bak'))).toEqual([])
  })
})
