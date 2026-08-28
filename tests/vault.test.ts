import type { Database } from 'better-sqlite3'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from '../src/main/db/database'
import * as books from '../src/main/repos/books'
import * as notes from '../src/main/repos/notes'
import {
  buildFrontmatter,
  exportVault,
  importVault,
  parseFrontmatter,
  slugify
} from '../src/main/services/vault'

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
    expect(slugify('a'.repeat(200)).length).toBeLessThanOrEqual(60)
  })
})

describe('frontmatter', () => {
  it('round-trips scalars and lists', () => {
    const yaml = buildFrontmatter({ title: 'Dune', rating: 5, tags: ['scifi', 'desert'] })
    const { frontmatter } = parseFrontmatter(`${yaml}\n\nbody text`)

    expect(frontmatter.title).toBe('Dune')
    expect(frontmatter.rating).toBe('5')
    expect(frontmatter.tags).toEqual(['scifi', 'desert'])
  })

  it('omits empty values instead of writing nulls', () => {
    const yaml = buildFrontmatter({ title: 'X', author: null, tags: [] })
    expect(yaml).not.toContain('author')
    expect(yaml).not.toContain('tags')
  })

  it('quotes values that would break the parse', () => {
    const yaml = buildFrontmatter({ title: 'Trouble: A Story, [bracketed]' })
    const { frontmatter } = parseFrontmatter(`${yaml}\n\nbody`)
    expect(frontmatter.title).toBe('Trouble: A Story, [bracketed]')
  })

  it('returns the whole text as body when there is no frontmatter', () => {
    const { frontmatter, body } = parseFrontmatter('just prose')
    expect(frontmatter).toEqual({})
    expect(body).toBe('just prose')
  })

  it('tolerates CRLF and a BOM', () => {
    const { frontmatter, body } = parseFrontmatter('﻿---\r\ntitle: Dune\r\n---\r\n\r\nbody')
    expect(frontmatter.title).toBe('Dune')
    expect(body).toBe('body')
  })
})

describe('export', () => {
  it('writes one file per book and per loose note', () => {
    const book = books.createBook(db, { title: 'The Dispossessed', author: 'Le Guin' })
    notes.createNote(db, { bookId: book.id, kind: 'review', bodyMd: 'Wonderful. #scifi' })
    notes.createNote(db, { bodyMd: 'A loose thought #idea' })

    const result = exportVault(db, dir)
    const vault = result.dir

    expect(result.files).toBe(2)
    expect(readdirSync(join(vault, 'books'))).toEqual(['the-dispossessed.md'])
    expect(readdirSync(join(vault, 'notes'))).toHaveLength(1)
  })

  it('puts book metadata in the frontmatter and the review in the body', () => {
    const book = books.createBook(db, { title: 'Dune', author: 'Herbert', status: 'read' })
    books.updateBook(db, book.id, { rating: 5 })
    notes.createNote(db, { bookId: book.id, kind: 'review', bodyMd: 'Sprawling. #scifi' })

    const { dir: vault } = exportVault(db, dir)
    const text = readFileSync(join(vault, 'books', 'dune.md'), 'utf8')

    expect(text).toContain('title: Dune')
    expect(text).toContain('author: Herbert')
    expect(text).toContain('rating: 5')
    expect(text).toContain('status: read')
    expect(text).toContain('## Review')
    expect(text).toContain('Sprawling.')
  })

  it('does not collide when two books share a title', () => {
    books.createBook(db, { title: 'Selected Poems', author: 'A' })
    books.createBook(db, { title: 'Selected Poems', author: 'B' })

    const { dir: vault } = exportVault(db, dir)
    expect(readdirSync(join(vault, 'books')).sort()).toEqual([
      'selected-poems-2.md',
      'selected-poems.md'
    ])
  })
})

describe('round trip', () => {
  it('restores books and reviews into an empty database', () => {
    const book = books.createBook(db, { title: 'The Dispossessed', author: 'Le Guin' })
    books.updateBook(db, book.id, { status: 'read', rating: 5 })
    notes.createNote(db, {
      bookId: book.id,
      kind: 'review',
      bodyMd: 'Ambiguous utopia.',
      tag: 'THEORY'
    })
    exportVault(db, dir)

    const fresh = createDatabase(':memory:')
    const result = importVault(fresh, dir)

    expect(result.books).toBe(1)

    const [restored] = books.listBooks(fresh)
    expect(restored).toMatchObject({
      title: 'The Dispossessed',
      author: 'Le Guin',
      status: 'read',
      rating: 5
    })

    const review = notes.listNotes(fresh, restored.id).find((n) => n.kind === 'review')
    expect(review?.bodyMd).toContain('Ambiguous utopia')
  })

  it('restores free-floating notes', () => {
    notes.createNote(db, { title: 'On Reading', bodyMd: 'Some thought' })
    exportVault(db, dir)

    const fresh = createDatabase(':memory:')
    const result = importVault(fresh, dir)

    expect(result.notes).toBe(1)
    expect(notes.listNotes(fresh, null)[0].title).toBe('On Reading')
  })

  it('updates rather than duplicating when importing over existing books', () => {
    const book = books.createBook(db, { title: 'Dune', author: 'Herbert' })
    books.updateBook(db, book.id, { rating: 4 })
    exportVault(db, dir)

    // Import back into the same database it came from.
    importVault(db, dir)

    expect(books.listBooks(db)).toHaveLength(1)
    expect(books.listBooks(db)[0].rating).toBe(4)
  })

  it('preserves reading dates through the round trip', () => {
    const book = books.createBook(db, { title: 'Dune' })
    const started = Math.floor(Date.parse('2026-03-01T00:00:00Z') / 1000)
    books.updateBook(db, book.id, { startedAt: started, status: 'reading' })
    exportVault(db, dir)

    const fresh = createDatabase(':memory:')
    importVault(fresh, dir)

    expect(books.listBooks(fresh)[0].startedAt).toBe(started)
  })

  it('ignores a directory with no markdown in it', () => {
    const empty = mkdtempSync(join(tmpdir(), 'interleaf-empty-'))
    try {
      expect(importVault(db, empty)).toEqual({ books: 0, notes: 0 })
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })
})
