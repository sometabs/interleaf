import type { Database } from 'better-sqlite3'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from '../src/main/db/database'
import * as books from '../src/main/repos/books'
import * as notes from '../src/main/repos/notes'
import { buildFrontmatter, slugify, writeVault } from '../src/main/services/vault'

let db: Database
let dir: string

beforeEach(() => {
  db = createDatabase(':memory:')
  dir = mkdtempSync(join(tmpdir(), 'interleaf-vault-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('slugify', () => {
  it('makes a readable filename', () => {
    expect(slugify('The Dispossessed')).toBe('the-dispossessed')
  })

  it('strips accents rather than dropping the word', () => {
    expect(slugify('Café Society')).toBe('cafe-society')
  })

  it('falls back when nothing survives', () => {
    expect(slugify('!!!')).toBe('untitled')
  })

  it('caps length so filenames stay usable', () => {
    expect(slugify('a'.repeat(200)).length).toBe(60)
  })
})

describe('frontmatter', () => {
  it('omits empty values instead of writing nulls', () => {
    expect(buildFrontmatter({ title: 'A', author: null, isbn: '' })).toBe('---\ntitle: A\n---')
  })

  it('quotes values that would break the parse', () => {
    expect(buildFrontmatter({ title: 'A: B' })).toContain('title: "A: B"')
  })
})

describe('what a vault holds', () => {
  it('writes one file per book and per loose note', () => {
    books.createBook(db, { title: 'Dune' })
    notes.createNote(db, { title: 'On Reading', bodyMd: 'Some thought' })

    expect(writeVault(db, dir)).toBe(2)
    expect(readdirSync(join(dir, 'markdown', 'books'))).toEqual(['dune.md'])
    expect(readdirSync(join(dir, 'markdown', 'notes'))).toEqual(['on-reading.md'])
  })

  it('keeps the prose in its own folder, apart from the database', () => {
    books.createBook(db, { title: 'Dune' })

    writeVault(db, dir)

    expect(existsSync(join(dir, 'markdown', 'books', 'dune.md'))).toBe(true)
    expect(existsSync(join(dir, 'books'))).toBe(false)
  })

  it('keeps the shelf state a reader would want, and none of the plumbing', () => {
    const book = books.createBook(db, { title: 'Dune', author: 'Herbert', status: 'read' })
    books.updateBook(db, book.id, { rating: 5, olid: 'OL1W', isbn: '9780441013593' })
    notes.createNote(db, { bookId: book.id, kind: 'review', bodyMd: 'Sprawling. #scifi' })

    writeVault(db, dir)
    const text = readFileSync(join(dir, 'markdown', 'books', 'dune.md'), 'utf8')

    expect(text).toContain('title: Dune')
    expect(text).toContain('author: Herbert')
    expect(text).toContain('status: read')
    expect(text).toContain('rating: 5')
    expect(text).toContain('## Review')
    expect(text).toContain('Sprawling.')

    // Identifiers are for the database, not for a person reading this.
    expect(text).not.toContain('olid:')
    expect(text).not.toContain('isbn:')
  })

  it('dates every passage, which is the one thing a journal cannot infer', () => {
    const book = books.createBook(db, { title: 'Dune' })
    notes.createNote(db, {
      bookId: book.id,
      kind: 'highlight',
      bodyMd: 'The spice must flow.',
      createdAt: Math.floor(Date.parse('2026-03-01T00:00:00Z') / 1000)
    })

    writeVault(db, dir)

    expect(readFileSync(join(dir, 'markdown', 'books', 'dune.md'), 'utf8')).toContain(
      '*2026-03-01*'
    )
  })

  it('dates a note that belongs to no book', () => {
    notes.createNote(db, {
      title: 'On Reading',
      bodyMd: 'Some thought',
      createdAt: Math.floor(Date.parse('2025-11-20T00:00:00Z') / 1000)
    })

    writeVault(db, dir)

    expect(readFileSync(join(dir, 'markdown', 'notes', 'on-reading.md'), 'utf8')).toContain(
      'created: 2025-11-20'
    )
  })

  it('embeds the cover, so a Markdown reader shows the jacket', () => {
    const cache = join(dir, 'cache')
    mkdirSync(cache, { recursive: true })
    writeFileSync(join(cache, 'book-1-99.jpg'), 'JPEGBYTES')
    const book = books.createBook(db, { title: 'Dark Matter' })
    books.updateBook(db, book.id, { coverPath: 'book-1-99.jpg' })

    writeVault(db, dir, cache)

    expect(readFileSync(join(dir, 'markdown', 'books', 'dark-matter.md'), 'utf8')).toContain(
      '![](../../covers/book-1-99.jpg)'
    )
    expect(existsSync(join(dir, 'covers', 'book-1-99.jpg'))).toBe(true)
  })

  it('does not collide when two books share a title', () => {
    books.createBook(db, { title: 'Selected Poems', author: 'A' })
    books.createBook(db, { title: 'Selected Poems', author: 'B' })

    writeVault(db, dir)

    expect(readdirSync(join(dir, 'markdown', 'books')).sort()).toEqual([
      'selected-poems-2.md',
      'selected-poems.md'
    ])
  })
})
