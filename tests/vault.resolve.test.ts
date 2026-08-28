import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from '../src/main/db/database'
import * as books from '../src/main/repos/books'
import * as notes from '../src/main/repos/notes'
import { exportVault, importVault, resolveVaultRoot } from '../src/main/services/vault'

let parent: string

beforeEach(() => {
  parent = mkdtempSync(join(tmpdir(), 'vault-test-'))
})

function seed(): ReturnType<typeof createDatabase> {
  const db = createDatabase(':memory:')
  const book = books.createBook(db, {
    title: 'Dark Matter',
    author: 'Blake Crouch',
    status: 'read'
  })
  notes.createNote(db, { bookId: book.id, kind: 'review', bodyMd: 'Great' })
  notes.createNote(db, { bodyMd: '# Floating\n\nthought' })
  return db
}

describe('exporting', () => {
  it('puts everything in one named folder rather than loose in the one you picked', () => {
    const result = exportVault(seed(), parent)

    expect(result.dir).toBe(join(parent, 'interleaf-vault'))
  })

  it('overwrites a previous export instead of stacking copies', () => {
    const db = seed()
    const first = exportVault(db, parent)
    const second = exportVault(db, parent)

    expect(second.dir).toBe(first.dir)
  })
})

describe('finding the vault in whatever folder was picked', () => {
  it('takes the vault itself', () => {
    const { dir } = exportVault(seed(), parent)

    expect(resolveVaultRoot(dir)).toBe(dir)
  })

  it('finds it one level down', () => {
    const { dir } = exportVault(seed(), parent)

    expect(resolveVaultRoot(parent)).toBe(dir)
  })

  it('climbs out of the books folder', () => {
    const { dir } = exportVault(seed(), parent)

    expect(resolveVaultRoot(join(dir, 'books'))).toBe(dir)
  })

  it('climbs out of the notes folder', () => {
    const { dir } = exportVault(seed(), parent)

    expect(resolveVaultRoot(join(dir, 'notes'))).toBe(dir)
  })

  it('refuses to choose between two vaults', () => {
    // Both directly inside the picked folder: a deeper one is not a candidate.
    for (const name of ['vault-one', 'vault-two']) {
      mkdirSync(join(parent, name, 'books'), { recursive: true })
      mkdirSync(join(parent, name, 'notes'), { recursive: true })
    }

    expect(resolveVaultRoot(parent)).toBeNull()
  })

  it('gives up on a folder that is nothing to do with a vault', () => {
    mkdirSync(join(parent, 'holiday-photos'), { recursive: true })
    writeFileSync(join(parent, 'holiday-photos', 'readme.md'), '# not a vault')

    expect(resolveVaultRoot(parent)).toBeNull()
  })

  it('gives up on a folder that does not exist', () => {
    expect(resolveVaultRoot(join(parent, 'nowhere'))).toBeNull()
  })
})

describe('importing after an export', () => {
  it('restores the library from the folder that was exported into', () => {
    exportVault(seed(), parent)

    const restored = importVault(createDatabase(':memory:'), parent)

    expect(restored.books).toBe(1)
    expect(restored.notes).toBe(2)
  })

  it('restores it when pointed straight at the books folder', () => {
    const { dir } = exportVault(seed(), parent)

    const restored = importVault(createDatabase(':memory:'), join(dir, 'books'))

    expect(restored.books).toBe(1)
  })

  it('brings the book back with its details intact', () => {
    exportVault(seed(), parent)

    const db = createDatabase(':memory:')
    importVault(db, parent)

    expect(books.listBooks(db)[0]).toMatchObject({
      title: 'Dark Matter',
      author: 'Blake Crouch',
      status: 'read'
    })
  })
})

describe('covers in the vault', () => {
  function seedWithCover(cache: string): ReturnType<typeof createDatabase> {
    const db = createDatabase(':memory:')
    const book = books.createBook(db, { title: 'Dark Matter', author: 'Blake Crouch' })
    mkdirSync(cache, { recursive: true })
    writeFileSync(join(cache, 'book-1-99.jpg'), 'JPEGBYTES')
    books.updateBook(db, book.id, { coverPath: 'book-1-99.jpg' })
    return db
  }

  it('copies the image into the vault', () => {
    const cache = join(parent, 'cache')
    const { dir } = exportVault(seedWithCover(cache), parent, cache)

    expect(existsSync(join(dir, 'covers', 'book-1-99.jpg'))).toBe(true)
  })

  it('records the filename in the book file', () => {
    const cache = join(parent, 'cache')
    const { dir } = exportVault(seedWithCover(cache), parent, cache)

    expect(readFileSync(join(dir, 'books', 'dark-matter.md'), 'utf8')).toContain(
      'cover: book-1-99.jpg'
    )
  })

  it('puts the image back on import and points the book at it', () => {
    const cache = join(parent, 'cache')
    exportVault(seedWithCover(cache), parent, cache)

    const restoredCache = join(parent, 'other-cache')
    const db = createDatabase(':memory:')
    importVault(db, parent, restoredCache)

    expect(books.listBooks(db)[0].coverPath).toBe('book-1-99.jpg')
    expect(readFileSync(join(restoredCache, 'book-1-99.jpg'), 'utf8')).toBe('JPEGBYTES')
  })

  // A name whose file never arrived renders a broken tile; null renders the
  // placeholder.
  it('claims no cover when the image is missing from the vault', () => {
    const cache = join(parent, 'cache')
    const { dir } = exportVault(seedWithCover(cache), parent, cache)
    rmSync(join(dir, 'covers'), { recursive: true, force: true })

    const db = createDatabase(':memory:')
    importVault(db, parent, join(parent, 'other-cache'))

    expect(books.listBooks(db)[0].coverPath).toBeNull()
  })

  // The source is made to exist on purpose: a name that merely fails to copy
  // proves nothing, since a missing file fails for every name.
  it('refuses a cover name that climbs out of the folder', () => {
    const vault = join(parent, 'interleaf-vault')
    mkdirSync(join(vault, 'books'), { recursive: true })
    mkdirSync(join(vault, 'covers'), { recursive: true })
    writeFileSync(join(vault, 'escape.jpg'), 'PAYLOAD')
    writeFileSync(
      join(vault, 'books', 'evil.md'),
      ['---', 'title: Evil', 'cover: "../escape.jpg"', '---', '', '# Evil', ''].join('\n')
    )

    const cache = join(parent, 'cache', 'covers')
    const db = createDatabase(':memory:')
    importVault(db, parent, cache)

    expect(books.listBooks(db)[0].coverPath).toBeNull()
    // The destination is built from this name too, so it escapes both ways.
    expect(existsSync(join(cache, '..', 'escape.jpg'))).toBe(false)
  })
})
