import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'

import { createDatabase, MIGRATIONS } from '../src/main/db/database'
import * as books from '../src/main/repos/books'
import * as meta from '../src/main/repos/metadata'
import * as notes from '../src/main/repos/notes'
import { toPlainText } from '../src/shared/plaintext'

let db: Database.Database

beforeEach(() => {
  db = createDatabase(':memory:')
})

describe('migrations', () => {
  it('brings a fresh database to the current schema version', () => {
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
  })

  it('upgrades a database left at 12 and drops app_setting', () => {
    const old = new Database(':memory:')
    // Registered by hand because `createDatabase` would migrate past 12.
    old.function('strip_markdown', { deterministic: true }, (value: unknown) =>
      typeof value === 'string' ? toPlainText(value) : value
    )
    for (let version = 0; version < 12; version++) {
      old.exec(MIGRATIONS[version])
    }
    old.pragma('user_version = 12')
    old.prepare('INSERT INTO app_setting (key, value) VALUES (?, ?)').run('backup.lastAt', '1')

    applyPending(old)

    expect(old.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
    expect(tableExists(old, 'app_setting')).toBe(false)
    expect(tableExists(old, 'book')).toBe(true)
    expect(tableExists(old, 'note')).toBe(true)
  })

  it('is idempotent when re-applied to an already-migrated database', () => {
    const before = db.pragma('user_version', { simple: true })
    expect(() => createDatabase(':memory:')).not.toThrow()
    expect(db.pragma('user_version', { simple: true })).toBe(before)
  })
})

describe('books', () => {
  it('round-trips a book through create and read', () => {
    const created = books.createBook(db, { title: 'The Dispossessed', author: 'Le Guin' })
    expect(created.id).toBeGreaterThan(0)
    expect(created.status).toBe('want')
    expect(books.getBook(db, created.id)).toEqual(created)
  })

  it('applies a partial patch without disturbing other columns', () => {
    const book = books.createBook(db, { title: 'Dune', author: 'Herbert' })
    const updated = books.updateBook(db, book.id, { status: 'read', rating: 5 })
    expect(updated).toMatchObject({ title: 'Dune', author: 'Herbert', status: 'read', rating: 5 })
  })

  it('ignores unknown patch keys rather than building bad SQL', () => {
    const book = books.createBook(db, { title: 'Dune' })
    // @ts-expect-error deliberately passing a key outside the whitelist
    const updated = books.updateBook(db, book.id, { nonsense: 1, title: 'Dune Messiah' })
    expect(updated?.title).toBe('Dune Messiah')
  })

  it('rejects an out-of-range rating at the schema level', () => {
    const book = books.createBook(db, { title: 'Dune' })
    expect(() => books.updateBook(db, book.id, { rating: 9 })).toThrow()
  })

  it('cascades deletion to the book notes', () => {
    const book = books.createBook(db, { title: 'Dune' })
    notes.createNote(db, { bookId: book.id, kind: 'review', bodyMd: 'good' })
    books.deleteBook(db, book.id)
    expect(notes.listNotes(db)).toHaveLength(0)
  })
})

describe('notes', () => {
  it('stores the label it was given', () => {
    const note = notes.createNote(db, { bodyMd: 'Great read', tag: 'THEORY' })
    expect(note.tag).toBe('THEORY')
  })

  it('starts untagged', () => {
    expect(notes.createNote(db, { bodyMd: 'Great read' }).tag).toBeNull()
  })

  it('changes and clears the label', () => {
    const note = notes.createNote(db, { bodyMd: 'x', tag: 'THEORY' })
    expect(notes.updateNote(db, note.id, { tag: 'SUMMARY' })?.tag).toBe('SUMMARY')
    expect(notes.updateNote(db, note.id, { tag: null })?.tag).toBeNull()
  })

  it('keeps the label when the body is edited', () => {
    const note = notes.createNote(db, { bodyMd: 'x', tag: 'SUMMARY' })
    expect(notes.updateNote(db, note.id, { bodyMd: 'y' })?.tag).toBe('SUMMARY')
  })

  it('refuses a label that is not on the list', () => {
    expect(notes.createNote(db, { bodyMd: 'x', tag: 'Nonsense' }).tag).toBeNull()
  })

  // A vault exported before labels were capitalised says `tag: Theory`.
  it('accepts a label written the way it used to be', () => {
    expect(notes.createNote(db, { bodyMd: 'x', tag: 'Theory' }).tag).toBe('THEORY')
    expect(notes.createNote(db, { bodyMd: 'y', tag: 'summary' }).tag).toBe('SUMMARY')
  })

  it('folds the case of a label given to an existing note', () => {
    const note = notes.createNote(db, { bodyMd: 'x' })
    expect(notes.updateNote(db, note.id, { tag: 'Theory' })?.tag).toBe('THEORY')
  })

  it('capitalises the labels already on disk', () => {
    const note = notes.createNote(db, { bodyMd: 'x', tag: 'THEORY' })
    db.prepare('UPDATE note SET tag = ? WHERE id = ?').run('Theory', note.id)
    const untagged = notes.createNote(db, { bodyMd: 'y' })

    // The migration alone: replaying the chain would re-run later ones too.
    db.exec(MIGRATIONS[7])

    expect(notes.getNote(db, note.id)?.tag).toBe('THEORY')
    expect(notes.getNote(db, untagged.id)?.tag).toBeNull()
  })

  it('no longer treats #hashtags in the prose as anything', () => {
    const note = notes.createNote(db, { bodyMd: 'Great read #scifi #utopia' })
    expect(note.tag).toBeNull()
    expect(note.bodyMd).toBe('Great read #scifi #utopia')
  })

  it('derives a title from the body when none is given', () => {
    const note = notes.createNote(db, { bodyMd: '# On Utopias\n\nbody' })
    expect(note.title).toBe('On Utopias')
  })

  it('never rewrites a title the user chose', () => {
    const note = notes.createNote(db, { title: 'My Title', bodyMd: '# Heading' })
    const updated = notes.updateNote(db, note.id, { bodyMd: '# Different Heading' })
    expect(updated?.title).toBe('My Title')
  })

  it('keeps an auto-derived title in step with the body', () => {
    const note = notes.createNote(db, { bodyMd: '# First Heading\n\nbody' })
    expect(note.title).toBe('First Heading')

    const updated = notes.updateNote(db, note.id, { bodyMd: '# Second Heading\n\nbody' })
    expect(updated?.title).toBe('Second Heading')
  })

  it('stops auto-deriving once the user sets a title explicitly', () => {
    const note = notes.createNote(db, { bodyMd: '# Auto' })
    notes.updateNote(db, note.id, { title: 'Chosen' })
    const updated = notes.updateNote(db, note.id, { bodyMd: '# Changed Again' })
    expect(updated?.title).toBe('Chosen')
  })

  it('allows only one review per book, with a readable error', () => {
    const book = books.createBook(db, { title: 'Dune' })
    notes.createNote(db, { bookId: book.id, kind: 'review', bodyMd: 'first' })
    expect(() =>
      notes.createNote(db, { bookId: book.id, kind: 'review', bodyMd: 'second' })
    ).toThrow(/already has a review/)
  })

  it('allows many thoughts on the same book', () => {
    const book = books.createBook(db, { title: 'Dune' })
    notes.createNote(db, { bookId: book.id, bodyMd: 'one' })
    notes.createNote(db, { bookId: book.id, bodyMd: 'two' })
    expect(notes.listNotes(db, book.id)).toHaveLength(2)
  })

  it('separates free-floating notes from book notes', () => {
    const book = books.createBook(db, { title: 'Dune' })
    notes.createNote(db, { bookId: book.id, bodyMd: 'attached' })
    notes.createNote(db, { bodyMd: 'floating' })
    expect(notes.listNotes(db, null)).toHaveLength(1)
    expect(notes.listNotes(db)).toHaveLength(2)
  })
})

describe('candidate languages', () => {
  function harvested(olid: string, languages: string[], source: string): meta.CandidateRow {
    return {
      olid,
      title: `Book ${olid}`,
      author: 'Someone',
      subjects: ['science fiction'],
      description: null,
      coverId: null,
      source,
      languages
    }
  }

  it('stores and returns the codes a harvest reported', () => {
    meta.upsertCandidates(db, [harvested('OL1W', ['eng', 'fre'], 'author:Someone')])

    expect(meta.scorableCandidates(db)[0].languages).toEqual(['eng', 'fre'])
  })

  it('reads a row migrated from before the column existed as unknown', () => {
    meta.upsertCandidates(db, [harvested('OL1W', [], 'subject:x')])
    db.prepare('UPDATE book_candidate SET languages = NULL').run()

    // Null rather than '[]': the shape the migration leaves behind.
    expect(meta.scorableCandidates(db)[0].languages).toEqual([])
  })

  it('does not let a subject harvest erase what a search harvest established', () => {
    // /subjects/ never reports language, so an empty list must not overwrite.
    meta.upsertCandidates(db, [harvested('OL1W', ['jpn'], 'author:Someone')])
    meta.upsertCandidates(db, [harvested('OL1W', [], 'subject:science fiction')])

    expect(meta.scorableCandidates(db)[0].languages).toEqual(['jpn'])
  })

  it('still updates languages when a later harvest actually knows some', () => {
    meta.upsertCandidates(db, [harvested('OL1W', ['jpn'], 'subject:x')])
    meta.upsertCandidates(db, [harvested('OL1W', ['jpn', 'eng'], 'author:Someone')])

    expect(meta.scorableCandidates(db)[0].languages).toEqual(['jpn', 'eng'])
  })
})

describe('the candidate pool cleanup', () => {
  it('empties a pool carried over from before the fix', () => {
    meta.upsertCandidates(db, [
      {
        olid: 'OL846513W',
        title: 'Os Maias',
        author: 'Eça de Queiroz',
        subjects: [],
        description: null,
        coverId: 104218,
        source: 'subject:portuguese fiction',
        languages: ['eng']
      }
    ])
    expect(meta.scorableCandidates(db)).toHaveLength(1)

    // The migration alone: replaying the chain would re-run later ones too.
    db.exec(MIGRATIONS[5])

    expect(meta.scorableCandidates(db)).toHaveLength(0)
  })

  it('keeps every dismissal, so a refused book stays refused', () => {
    meta.recordFeedback(db, 'OL846513W', 'dismissed')

    db.exec(MIGRATIONS[5])

    const kept = db
      .prepare("SELECT count(*) AS n FROM rec_feedback WHERE action = 'dismissed'")
      .get() as { n: number }
    expect(kept.n).toBe(1)
  })

  it('leaves the library alone', () => {
    books.createBook(db, { title: 'Dark Matter', author: 'Blake Crouch' })

    db.exec(MIGRATIONS[5])

    expect(books.listBooks(db)).toHaveLength(1)
  })
})

describe('a candidate harvested again', () => {
  function harvested(title: string, coverId: number | null): meta.CandidateRow {
    return {
      olid: 'OL1W',
      title,
      author: 'Fyodor Dostoyevsky',
      subjects: ['russian literature'],
      description: null,
      coverId,
      source: 'author:Fyodor Dostoyevsky',
      languages: ['eng']
    }
  }

  it('takes the newer title', () => {
    meta.upsertCandidates(db, [harvested('Братья Карамазовы', 1)])
    meta.upsertCandidates(db, [harvested('The Brothers Karamazov', 2)])

    expect(meta.scorableCandidates(db)[0].title).toBe('The Brothers Karamazov')
  })

  it('takes the newer title even when the old one was already readable', () => {
    meta.upsertCandidates(db, [harvested('Os Maias', 1)])
    meta.upsertCandidates(db, [harvested('The maias', 2)])

    expect(meta.scorableCandidates(db)[0].title).toBe('The maias')
  })

  it('brings the new cover with the new title', () => {
    meta.upsertCandidates(db, [harvested('Братья Карамазовы', 1)])
    meta.upsertCandidates(db, [harvested('The Brothers Karamazov', 2)])

    expect(meta.scorableCandidates(db)[0].coverId).toBe(2)
  })

  it('drops the old cover rather than pair it with a different title', () => {
    meta.upsertCandidates(db, [harvested('Братья Карамазовы', 1)])
    meta.upsertCandidates(db, [harvested('The Brothers Karamazov', null)])

    expect(meta.scorableCandidates(db)[0].coverId).toBeNull()
  })

  it('keeps a cover a later harvest simply did not carry', () => {
    meta.upsertCandidates(db, [harvested('The Brothers Karamazov', 1)])
    meta.upsertCandidates(db, [harvested('The Brothers Karamazov', null)])

    expect(meta.scorableCandidates(db)[0].coverId).toBe(1)
  })
})

describe('the update whitelist', () => {
  function make(): number {
    return books.createBook(db, { title: 'The Dispossessed' }).id
  }

  it('applies the fields it knows', () => {
    const id = make()
    expect(books.updateBook(db, id, { title: 'Renamed', rating: 5 })).toMatchObject({
      title: 'Renamed',
      rating: 5
    })
  })

  // `k in BOOK_COLUMNS` is true for every Object.prototype key, so these would
  // pass the filter and interpolate a function's source into the SET clause.
  it('ignores keys inherited from Object.prototype', () => {
    const id = make()

    for (const key of ['toString', 'constructor', 'valueOf', 'hasOwnProperty']) {
      const patch = { [key]: 'x' } as unknown as Parameters<typeof books.updateBook>[2]
      expect(() => books.updateBook(db, id, patch), key).not.toThrow()
    }

    expect(books.getBook(db, id)?.title).toBe('The Dispossessed')
  })

  it('ignores a __proto__ key without polluting anything', () => {
    const id = make()
    const patch = JSON.parse('{"__proto__":{"polluted":true},"title":"Still fine"}')

    expect(() => books.updateBook(db, id, patch)).not.toThrow()
    expect(books.getBook(db, id)?.title).toBe('Still fine')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

function applyPending(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.exec(MIGRATIONS[version])
    db.pragma(`user_version = ${version + 1}`)
  }
}

function tableExists(db: Database.Database, name: string): boolean {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
    undefined
  )
}
