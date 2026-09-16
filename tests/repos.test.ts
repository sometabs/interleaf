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

  it('adds edition identity without changing shelf books', () => {
    const old = createDatabase(':memory:', 15)
    old.prepare("INSERT INTO book (title) VALUES ('Being and Nothingness')").run()
    old.prepare("INSERT INTO book_candidate (olid, title) VALUES ('OL1W', 'A candidate')").run()

    old.exec(MIGRATIONS[15])

    const book = old.prepare('SELECT title, edition_olid FROM book').get() as {
      title: string
      edition_olid: string | null
    }
    expect(book).toEqual({ title: 'Being and Nothingness', edition_olid: null })
    expect(old.prepare('SELECT count(*) AS n FROM book_candidate').get() as { n: number }).toEqual({
      n: 0
    })
  })

  it('adds an empty priority queue without changing shelf books', () => {
    const old = createDatabase(':memory:', 16)
    old.prepare("INSERT INTO book (title) VALUES ('The Left Hand of Darkness')").run()

    old.exec(MIGRATIONS[16])

    expect(old.prepare('SELECT title, priority_position FROM book').get()).toEqual({
      title: 'The Left Hand of Darkness',
      priority_position: null
    })
  })

  it('turns the whole existing Want to read shelf into an ordered queue', () => {
    const old = createDatabase(':memory:', 17)
    old.prepare("INSERT INTO book (title, status) VALUES ('Dune', 'want')").run()
    old.prepare("INSERT INTO book (title, status) VALUES ('Solaris', 'want')").run()
    old.prepare("INSERT INTO book (title, status) VALUES ('Read', 'read')").run()

    old.exec(MIGRATIONS[17])

    expect(old.prepare('SELECT title, priority_position FROM book ORDER BY id').all()).toEqual([
      { title: 'Dune', priority_position: 1 },
      { title: 'Solaris', priority_position: 2 },
      { title: 'Read', priority_position: null }
    ])
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

  it('appends every want-to-read book and lets the reader rearrange them', () => {
    const first = books.createBook(db, { title: 'Dune' })
    const second = books.createBook(db, { title: 'Solaris' })

    expect(first.priorityPosition).toBe(1)
    expect(second.priorityPosition).toBe(2)

    books.reorderPriority(db, [second.id, first.id])

    expect(books.getBook(db, second.id)?.priorityPosition).toBe(1)
    expect(books.getBook(db, first.id)?.priorityPosition).toBe(2)
  })

  it('removes a book from priority when it leaves Want to read', () => {
    const book = books.createBook(db, { title: 'Dune' })

    const updated = books.updateBook(db, book.id, { status: 'reading' })

    expect(updated?.priorityPosition).toBeNull()
  })

  it('appends a book when it moves into Want to read', () => {
    const first = books.createBook(db, { title: 'Dune' })
    const book = books.createBook(db, { title: 'Dune', status: 'read' })

    const updated = books.updateBook(db, book.id, { status: 'want' })

    expect(first.priorityPosition).toBe(1)
    expect(updated?.priorityPosition).toBe(2)
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
      editionOlid: null,
      isbn: null,
      title: `Book ${olid}`,
      author: 'Someone',
      subjects: ['science fiction'],
      description: null,
      coverId: null,
      pageCount: null,
      publishedYear: null,
      source,
      languages
    }
  }

  it('stores and returns the codes a harvest reported', () => {
    meta.upsertCandidates(db, [harvested('OL1W', ['eng', 'fre'], 'author:Someone')])

    expect(meta.scorableCandidates(db)[0].languages).toEqual(['eng', 'fre'])
  })

  it('keeps the selected edition details together', () => {
    const row = harvested('OL1W', ['eng'], 'author:Someone')
    row.editionOlid = 'OL10M'
    row.isbn = '9780000000001'
    row.pageCount = 320
    row.publishedYear = 1999
    row.coverId = 77

    meta.upsertCandidates(db, [row])

    expect(meta.scorableCandidates(db)[0]).toMatchObject({
      editionOlid: 'OL10M',
      isbn: '9780000000001',
      pageCount: 320,
      publishedYear: 1999,
      coverId: 77
    })
  })

  it('reads a row migrated from before the column existed as unknown', () => {
    meta.upsertCandidates(db, [harvested('OL1W', [], 'subject:x')])
    db.prepare('UPDATE book_candidate SET languages = NULL').run()

    // Null rather than '[]': the shape the migration leaves behind.
    expect(meta.scorableCandidates(db)[0].languages).toEqual([])
  })

  it('stores the latest language list exactly, including an empty one', () => {
    meta.upsertCandidates(db, [harvested('OL1W', ['jpn'], 'author:Someone')])
    meta.upsertCandidates(db, [harvested('OL1W', [], 'subject:science fiction')])

    expect(meta.scorableCandidates(db)[0].languages).toEqual([])
  })

  it('still updates languages when a later harvest actually knows some', () => {
    meta.upsertCandidates(db, [harvested('OL1W', ['jpn'], 'subject:x')])
    meta.upsertCandidates(db, [harvested('OL1W', ['jpn', 'eng'], 'author:Someone')])

    expect(meta.scorableCandidates(db)[0].languages).toEqual(['jpn', 'eng'])
  })
})

describe('metadata refreshes', () => {
  it('stores an empty Open Library refresh instead of overruling it', () => {
    const book = books.createBook(db, { title: 'Beyond Good and Evil' })
    meta.saveBookMetadata(db, book.id, {
      subjects: ['Philosophy', 'Ethics'],
      description: 'A critique of traditional morality.'
    })

    meta.saveBookMetadata(db, book.id, { subjects: [], description: null })

    expect(meta.getBookMetadata(db, book.id)).toMatchObject({
      subjects: [],
      description: null
    })
  })

  it('stores an empty candidate subject list instead of overruling it', () => {
    const row = (subjects: string[]): meta.CandidateRow => ({
      olid: 'OL1W',
      editionOlid: null,
      isbn: null,
      title: 'A book',
      author: 'Someone',
      subjects,
      description: null,
      coverId: null,
      pageCount: null,
      publishedYear: null,
      source: 'genre:philosophy',
      languages: ['eng']
    })

    meta.upsertCandidates(db, [row(['Philosophy', 'Ethics'])])
    meta.upsertCandidates(db, [row([])])

    expect(meta.scorableCandidates(db)[0].subjects).toEqual([])
  })
})

describe('duplicate candidates', () => {
  function candidate(olid: string, author = 'Jane Austen'): meta.CandidateRow {
    return {
      olid,
      editionOlid: null,
      isbn: null,
      title: 'Pride and Prejudice',
      author,
      subjects: ['Romance'],
      description: null,
      coverId: null,
      pageCount: null,
      publishedYear: null,
      source: 'genre:romance',
      languages: ['eng']
    }
  }

  it('shows one copy of the same title and author', () => {
    meta.upsertCandidates(db, [candidate('OL1W'), candidate('OL2W')])

    expect(meta.scorableCandidates(db)).toHaveLength(1)
  })

  it('keeps the first duplicate instead of reranking by metadata richness', () => {
    const first = candidate('OL1W')
    const later = candidate('OL2W')
    later.description = 'A richer description.'
    later.subjects = ['Romance', 'England', 'Courtship']
    later.coverId = 99

    meta.upsertCandidates(db, [first, later])

    expect(meta.scorableCandidates(db)[0].olid).toBe('OL1W')
  })

  it('does not collapse different authors who used the same title', () => {
    meta.upsertCandidates(db, [candidate('OL1W'), candidate('OL2W', 'Another Writer')])

    expect(meta.scorableCandidates(db)).toHaveLength(2)
  })

  it('keeps a dismissed duplicate from returning under another work id', () => {
    meta.upsertCandidates(db, [candidate('OL1W')])
    meta.recordFeedback(db, 'OL1W', 'dismissed')
    meta.upsertCandidates(db, [candidate('OL2W')])

    expect(meta.scorableCandidates(db)).toEqual([])
  })

  it('keeps a dismissed title variant from returning under another work id', () => {
    const short = candidate('OL1W', 'Albert Camus')
    short.title = 'The Myth of Sisyphus'
    meta.upsertCandidates(db, [short])
    meta.recordFeedback(db, 'OL1W', 'dismissed')

    const collection = candidate('OL2W', 'Albert Camus')
    collection.title = 'The Myth of Sisyphus and Other Essays'
    meta.upsertCandidates(db, [collection])

    expect(meta.scorableCandidates(db)).toEqual([])
  })

  it('hides a separately catalogued shorter title already contained in the library', () => {
    books.createBook(db, {
      title: 'The Myth of Sisyphus and Other Essays',
      author: 'Albert Camus',
      olid: 'OL1230690W'
    })
    const duplicate = candidate('OL1230601W', 'Albert Camus')
    duplicate.title = 'The Myth of Sisyphus'
    meta.upsertCandidates(db, [duplicate])

    expect(meta.scorableCandidates(db)).toEqual([])
  })

  it('does not hide a one-word series title inside a sequel', () => {
    books.createBook(db, { title: 'Dune', author: 'Frank Herbert', olid: 'OL1W' })
    const sequel = candidate('OL2W', 'Frank Herbert')
    sequel.title = 'Dune Messiah'
    meta.upsertCandidates(db, [sequel])

    expect(meta.scorableCandidates(db).map((book) => book.title)).toEqual(['Dune Messiah'])
  })

  it('does not collapse similar titles written by different authors', () => {
    books.createBook(db, {
      title: 'The Myth of Sisyphus and Other Essays',
      author: 'Albert Camus'
    })
    const otherAuthor = candidate('OL2W', 'Another Writer')
    otherAuthor.title = 'The Myth of Sisyphus'
    meta.upsertCandidates(db, [otherAuthor])

    expect(meta.scorableCandidates(db)).toHaveLength(1)
  })

  it('collapses title variants inside the candidate pool', () => {
    const short = candidate('OL1W', 'Albert Camus')
    short.title = 'The Myth of Sisyphus'
    const collection = candidate('OL2W', 'Albert Camus')
    collection.title = 'The Myth of Sisyphus and Other Essays'
    meta.upsertCandidates(db, [short, collection])

    expect(meta.scorableCandidates(db).map((book) => book.olid)).toEqual(['OL1W'])
  })
})

describe('the candidate pool cleanup', () => {
  it('replaces stale candidates after a complete harvest', () => {
    const row = (olid: string): meta.CandidateRow => ({
      olid,
      editionOlid: null,
      isbn: null,
      title: `Book ${olid}`,
      author: 'Someone',
      subjects: ['science fiction'],
      description: null,
      coverId: null,
      pageCount: null,
      publishedYear: null,
      source: 'subjects:science_fiction+politics',
      languages: ['eng']
    })

    meta.upsertCandidates(db, [row('OLD')])
    meta.replaceCandidates(db, [row('NEW')])

    expect(meta.scorableCandidates(db).map((candidate) => candidate.olid)).toEqual(['NEW'])
  })

  it('empties a pool carried over from before the fix', () => {
    meta.upsertCandidates(db, [
      {
        olid: 'OL846513W',
        editionOlid: null,
        isbn: null,
        title: 'Os Maias',
        author: 'Eça de Queiroz',
        subjects: [],
        description: null,
        coverId: 104218,
        pageCount: null,
        publishedYear: null,
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
      editionOlid: null,
      isbn: null,
      title,
      author: 'Fyodor Dostoyevsky',
      subjects: ['russian literature'],
      description: null,
      coverId,
      pageCount: null,
      publishedYear: null,
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

  it('stores a missing cover from the latest Open Library result', () => {
    meta.upsertCandidates(db, [harvested('The Brothers Karamazov', 1)])
    meta.upsertCandidates(db, [harvested('The Brothers Karamazov', null)])

    expect(meta.scorableCandidates(db)[0].coverId).toBeNull()
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
