import type Database from 'better-sqlite3'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

import { createDatabase } from '../src/main/db/database'
import * as books from '../src/main/repos/books'
import * as files from '../src/main/repos/bookFiles'
import * as notes from '../src/main/repos/notes'
import {
  attachEpub,
  describeEpub,
  detachEpub,
  pruneOrphanEpubs,
  readStoredEpub
} from '../src/main/services/bookFiles'
import {
  encryptsContent,
  inspectEpub,
  NOT_AN_EPUB,
  PROTECTED_EPUB
} from '../src/main/services/epub'
import { exportBackup, restoreBackup } from '../src/main/services/backup'
import { makeEpub, zipStored } from './helpers/epub'

const ENCRYPTED_TEXT = `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#">
    <EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/>
    <CipherData><CipherReference URI="OEBPS/c0.xhtml"/></CipherData>
  </EncryptedData>
</encryption>`

const OBFUSCATED_FONT = `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <enc:EncryptedData xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
    <enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/>
    <enc:CipherData><enc:CipherReference URI="OEBPS/font.otf"/></enc:CipherData>
  </enc:EncryptedData>
</encryption>`

describe('reading an EPUB', () => {
  it('takes title, author and ISBN from the package file', async () => {
    const details = await inspectEpub(
      makeEpub({ title: 'Salt &amp; Cinder', author: 'Ines Varga', isbn: '978-0-00-000000-2' })
    )

    expect(details).toMatchObject({
      title: 'Salt & Cinder',
      author: 'Ines Varga',
      isbn: '9780000000002'
    })
    expect(details.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('leaves the ISBN empty when the identifier is not one', async () => {
    expect((await inspectEpub(makeEpub())).isbn).toBeNull()
  })

  it('refuses a file that is not a zip', async () => {
    await expect(inspectEpub(new TextEncoder().encode('just text'))).rejects.toThrow(NOT_AN_EPUB)
  })

  it('refuses a zip without an EPUB package', async () => {
    await expect(inspectEpub(zipStored({ 'readme.txt': 'hello' }))).rejects.toThrow(NOT_AN_EPUB)
  })

  it.each(['META-INF/rights.xml', 'META-INF/license.lcpl', 'META-INF/sinf.xml'])(
    'refuses a protected book marked by %s',
    async (marker) => {
      await expect(inspectEpub(makeEpub({ extra: { [marker]: '<x/>' } }))).rejects.toThrow(
        PROTECTED_EPUB
      )
    }
  )

  it('refuses a book whose text is encrypted', async () => {
    await expect(
      inspectEpub(makeEpub({ extra: { 'META-INF/encryption.xml': ENCRYPTED_TEXT } }))
    ).rejects.toThrow(PROTECTED_EPUB)
  })

  // DRM-free books scramble embedded fonts with the same file.
  it('accepts a book whose only encrypted files are obfuscated fonts', async () => {
    expect(encryptsContent(OBFUSCATED_FONT)).toBe(false)
    await expect(
      inspectEpub(makeEpub({ extra: { 'META-INF/encryption.xml': OBFUSCATED_FONT } }))
    ).resolves.toMatchObject({ title: 'The Glass Orchard' })
  })
})

describe('attaching an EPUB to a book', () => {
  let db: Database.Database
  let root: string
  let store: string
  let source: string

  beforeEach(() => {
    db = createDatabase(':memory:')
    root = mkdtempSync(join(tmpdir(), 'interleaf-epub-'))
    store = join(root, 'books')
    source = join(root, 'source')
    for (const dir of [store, source]) mkdirSync(dir)
  })

  afterEach(() => {
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  function epubFile(name: string, title = 'The Glass Orchard'): string {
    const path = join(source, name)
    writeFileSync(path, makeEpub({ title }))
    return path
  }

  it('copies the file under its hash and reads it back', async () => {
    const book = books.createBook(db, { title: 'The Glass Orchard' })
    const path = epubFile('orchard.epub')

    expect(await attachEpub(db, store, book.id, path, false)).toEqual({ kind: 'attached' })

    expect(readdirSync(store)).toHaveLength(1)
    expect(files.listBookFiles(db)).toMatchObject([{ bookId: book.id, fileName: 'orchard.epub' }])
    expect(readStoredEpub(db, store, book.id).length).toBeGreaterThan(0)
  })

  it('recognises the same file already attached', async () => {
    const first = books.createBook(db, { title: 'The Glass Orchard' })
    const second = books.createBook(db, { title: 'Another' })
    const path = epubFile('orchard.epub')
    await attachEpub(db, store, first.id, path, false)

    expect(await attachEpub(db, store, first.id, path, false)).toEqual({ kind: 'already-attached' })
    expect(await attachEpub(db, store, second.id, path, false)).toEqual({
      kind: 'held-by',
      bookId: first.id
    })
    expect((await describeEpub(db, path)).bookId).toBe(first.id)
  })

  it('asks before replacing a different file, then removes the old one', async () => {
    const book = books.createBook(db, { title: 'The Glass Orchard' })
    await attachEpub(db, store, book.id, epubFile('first.epub', 'First'), false)
    files.saveReadingPosition(db, book.id, { cfi: 'epubcfi(/6/4!/4/2)', fraction: 0.4 })
    const second = epubFile('second.epub', 'Second')

    expect(await attachEpub(db, store, book.id, second, false)).toEqual({ kind: 'replace-needed' })
    expect(await attachEpub(db, store, book.id, second, true)).toEqual({ kind: 'attached' })

    expect(readdirSync(store)).toHaveLength(1)
    expect(files.listBookFiles(db)[0].fileName).toBe('second.epub')
    expect(files.getReadingPosition(db, book.id)).toBeNull()
  })

  it('keeps quotes and notes when the file is removed', async () => {
    const book = books.createBook(db, { title: 'The Glass Orchard' })
    await attachEpub(db, store, book.id, epubFile('orchard.epub'), false)
    notes.createNote(db, {
      bookId: book.id,
      kind: 'highlight',
      bodyMd: 'The orchard was made of glass.',
      location: 'epubcfi(/6/4!/4/2,/1:0,/1:30)'
    })

    detachEpub(db, store, book.id)

    expect(readdirSync(store)).toHaveLength(0)
    expect(notes.listNotes(db, book.id)[0].location).toBe('epubcfi(/6/4!/4/2,/1:0,/1:30)')
  })

  it('refuses a file without the .epub extension', async () => {
    const book = books.createBook(db, { title: 'The Glass Orchard' })
    const path = join(source, 'orchard.zip')
    writeFileSync(path, makeEpub())

    await expect(attachEpub(db, store, book.id, path, false)).rejects.toThrow(NOT_AN_EPUB)
  })

  it('drops the file record and position with the book', async () => {
    const book = books.createBook(db, { title: 'The Glass Orchard' })
    await attachEpub(db, store, book.id, epubFile('orchard.epub'), false)
    files.saveReadingPosition(db, book.id, { cfi: 'epubcfi(/6/4!/4/2)', fraction: 0.4 })

    books.deleteBook(db, book.id)

    expect(files.listBookFiles(db)).toEqual([])
    expect(pruneOrphanEpubs(store, files.storedEpubNames(db))).toBe(1)
    expect(existsSync(store) && readdirSync(store)).toEqual([])
  })
})

describe('reading position', () => {
  it('keeps one position per book, clamped to the book', () => {
    const db = createDatabase(':memory:')
    const book = books.createBook(db, { title: 'The Glass Orchard' })
    files.setBookFile(db, book.id, { sha256: 'a'.repeat(64), fileName: 'a.epub', size: 10 })

    files.saveReadingPosition(db, book.id, { cfi: 'epubcfi(/6/2)', fraction: 0.2 })
    files.saveReadingPosition(db, book.id, { cfi: 'epubcfi(/6/8)', fraction: 1.4 })

    expect(files.getReadingPosition(db, book.id)).toEqual({ cfi: 'epubcfi(/6/8)', fraction: 1 })
  })
})

describe('backing up EPUBs', () => {
  it('copies attached files into an export and back on restore', async () => {
    const root = mkdtempSync(join(tmpdir(), 'interleaf-epub-backup-'))
    try {
      const [store, source, exports, fresh] = ['books', 'source', 'exports', 'fresh'].map((name) =>
        join(root, name)
      )
      for (const dir of [store, source, exports, fresh]) mkdirSync(dir)
      const db = createDatabase(join(root, 'live.db'))
      const book = books.createBook(db, { title: 'The Glass Orchard' })
      const path = join(source, 'orchard.epub')
      writeFileSync(path, makeEpub())
      await attachEpub(db, store, book.id, path, false)

      const { dir } = exportBackup(db, exports, undefined, store)
      db.close()
      expect(readdirSync(join(dir, 'books'))).toHaveLength(1)

      const freshStore = join(fresh, 'books')
      restoreBackup(dir, join(fresh, 'interleaf.db'), join(fresh, 'covers'), {
        epubDir: freshStore
      })
      const restored = createDatabase(join(fresh, 'interleaf.db'))
      try {
        expect(readStoredEpub(restored, freshStore, book.id).length).toBeGreaterThan(0)
      } finally {
        restored.close()
      }
    } finally {
      try {
        rmSync(root, { recursive: true, force: true })
      } catch {
        // Left for the OS if a handle is still open.
      }
    }
  })
})

describe('recent reading', () => {
  it('lists books read in the reader, latest first, while they still have their EPUB', () => {
    const db = createDatabase(':memory:')
    const first = books.createBook(db, { title: 'First' })
    const second = books.createBook(db, { title: 'Second' })
    const detached = books.createBook(db, { title: 'Detached' })
    files.setBookFile(db, first.id, { sha256: 'a'.repeat(64), fileName: 'a.epub', size: 1 })
    files.setBookFile(db, second.id, { sha256: 'b'.repeat(64), fileName: 'b.epub', size: 1 })
    files.setBookFile(db, detached.id, { sha256: 'c'.repeat(64), fileName: 'c.epub', size: 1 })
    files.saveReadingPosition(db, first.id, { cfi: 'epubcfi(/6/2)', fraction: 0.2 })
    files.saveReadingPosition(db, second.id, { cfi: 'epubcfi(/6/4)', fraction: 0.6 })
    files.saveReadingPosition(db, detached.id, { cfi: 'epubcfi(/6/6)', fraction: 0.9 })
    db.prepare('UPDATE reading_position SET updated_at = 100 WHERE book_id = ?').run(first.id)
    db.prepare('UPDATE reading_position SET updated_at = 200 WHERE book_id = ?').run(second.id)
    files.removeBookFile(db, detached.id)

    expect(files.recentReading(db).map((row) => [row.bookId, row.fraction])).toEqual([
      [second.id, 0.6],
      [first.id, 0.2]
    ])
  })
})
