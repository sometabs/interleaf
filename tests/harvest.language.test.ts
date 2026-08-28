import type { Database } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDatabase } from '../src/main/db/database'
import * as books from '../src/main/repos/books'
import { saveBookMetadata, scorableCandidates } from '../src/main/repos/metadata'

// Open Library returns exactly the fields named in `fields=`, so dropping one
// is silent: every book comes back without it and nothing errors.

let urls: string[] = []
let db: Database

function doc(key: string, title: string, language: string[]): unknown {
  return {
    key,
    title,
    author_name: ['Someone'],
    cover_i: 2,
    subject: ['science fiction'],
    language
  }
}

function installFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = String(input)
      urls.push(url)

      const body = url.includes('/works/')
        ? { title: 'A work', subjects: ['science fiction'], covers: [7] }
        : url.includes('q=subject')
          ? { docs: [doc('/works/OL1W', 'Subject hit', ['fre'])] }
          : { docs: [doc('/works/OL2W', 'Author hit', ['jpn', 'eng'])] }

      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => body,
        arrayBuffer: async () => new ArrayBuffer(4096)
      } as unknown as Response
    })
  )
}

// Fresh modules per test: the throttle holds its clock in module scope.
async function load(): Promise<{
  ol: typeof import('../src/main/services/openlibrary')
  harvest: typeof import('../src/main/services/harvest')
}> {
  vi.resetModules()
  return {
    ol: await import('../src/main/services/openlibrary'),
    harvest: await import('../src/main/services/harvest')
  }
}

beforeEach(() => {
  urls = []
  db = createDatabase(':memory:')
  vi.useFakeTimers()
  installFetch()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('asking Open Library for the language', () => {
  it('names the field when searching', async () => {
    const { ol } = await load()

    const done = ol.searchBooks('dune')
    await vi.advanceTimersByTimeAsync(5000)
    await done

    expect(urls[0]).toContain('language')
  })

  it('names the field when fetching an author', async () => {
    const { ol } = await load()

    const done = ol.fetchByAuthor('Le Guin')
    await vi.advanceTimersByTimeAsync(5000)
    await done

    expect(urls[0]).toContain('language')
  })
})

describe('storing what came back', () => {
  it('keeps the languages of a book found by author', async () => {
    const { harvest } = await load()
    const book = books.createBook(db, {
      title: 'Solaris',
      author: 'Stanisław Lem',
      status: 'read',
      rating: 5
    })
    saveBookMetadata(db, book.id, { subjects: ['science fiction'], description: null })

    const done = harvest.harvestCandidates(db)
    await vi.advanceTimersByTimeAsync(60_000)
    await done

    const found = scorableCandidates(db).find((c) => c.olid === 'OL2W')
    expect(found?.languages).toEqual(['jpn', 'eng'])
  })

  it('now knows the language of a subject-harvested book too', async () => {
    const { harvest } = await load()
    const book = books.createBook(db, {
      title: 'Solaris',
      author: 'Stanisław Lem',
      status: 'read',
      rating: 5
    })
    saveBookMetadata(db, book.id, { subjects: ['science fiction'], description: null })

    const done = harvest.harvestCandidates(db)
    await vi.advanceTimersByTimeAsync(60_000)
    await done

    const found = scorableCandidates(db).find((c) => c.olid === 'OL1W')
    expect(found?.languages).toEqual(['fre'])
  })
})

describe('spending the request on books you can read', () => {
  it('no longer calls the subjects endpoint at all', async () => {
    const { harvest } = await load()
    const book = books.createBook(db, {
      title: 'Solaris',
      author: 'Stanisław Lem',
      status: 'read',
      rating: 5
    })
    saveBookMetadata(db, book.id, { subjects: ['science fiction'], description: null })

    const done = harvest.harvestCandidates(db, ['eng'])
    await vi.advanceTimersByTimeAsync(60_000)
    await done

    // /subjects/ reports no language and takes no language parameter.
    expect(urls.filter((url) => url.includes('/subjects/'))).toEqual([])
    expect(urls.some((url) => url.includes('q=subject'))).toBe(true)
  })

  it('asks Open Library to filter, rather than fetching and discarding', async () => {
    const { harvest } = await load()
    const book = books.createBook(db, {
      title: 'Solaris',
      author: 'Stanisław Lem',
      status: 'read',
      rating: 5
    })
    saveBookMetadata(db, book.id, { subjects: ['science fiction'], description: null })

    const done = harvest.harvestCandidates(db, ['eng'])
    await vi.advanceTimersByTimeAsync(60_000)
    await done

    const searches = urls.filter((url) => url.includes('/search.json'))
    expect(searches.length).toBeGreaterThan(0)
    for (const url of searches) expect(url).toContain('language=eng')
  })

  it('locks a caller that passes nothing to English', async () => {
    const { ol } = await load()

    // The default, so a call site that forgets cannot widen the search.
    const done = ol.searchBooks('dune')
    await vi.advanceTimersByTimeAsync(5000)
    await done

    expect(urls[0]).toContain('language=eng')
  })
})

describe('the English lock', () => {
  it('is the default on every endpoint, called directly', async () => {
    const { ol } = await load()

    const author = ol.fetchByAuthor('Le Guin')
    await vi.advanceTimersByTimeAsync(5000)
    await author

    const subject = ol.fetchSubject('science fiction')
    await vi.advanceTimersByTimeAsync(5000)
    await subject

    expect(urls).toHaveLength(2)
    for (const url of urls) expect(url).toContain('language=eng')
  })

  it('asks for the nested editions, which is where an English title comes from', async () => {
    const { ol } = await load()

    const search = ol.searchBooks('dune')
    await vi.advanceTimersByTimeAsync(5000)
    await search

    const author = ol.fetchByAuthor('Le Guin')
    await vi.advanceTimersByTimeAsync(5000)
    await author

    const subject = ol.fetchSubject('science fiction')
    await vi.advanceTimersByTimeAsync(5000)
    await subject

    // Parsed rather than substring-matched: the subject query also carries
    // `sort=editions`, which would satisfy a substring check on its own.
    expect(urls).toHaveLength(3)
    for (const url of urls) {
      const fields = new URL(url).searchParams.get('fields') ?? ''
      expect(fields.split(',')).toContain('editions')
      // Naming a sub-field narrows the block to exactly those named.
      expect(fields.split(',')).toContain('editions.title')
      expect(fields.split(',')).toContain('editions.cover_i')
    }
  })

  // Search only: a candidate row keeps no ISBN, so the harvests do not ask.
  it('asks the search for the edition’s ISBN, and only the search', async () => {
    const { ol } = await load()

    const search = ol.searchBooks('dostoevsky')
    await vi.advanceTimersByTimeAsync(5000)
    await search

    const subject = ol.fetchSubject('science fiction')
    await vi.advanceTimersByTimeAsync(5000)
    await subject

    const [searchFields, subjectFields] = urls.map((url) =>
      (new URL(url).searchParams.get('fields') ?? '').split(',')
    )

    // Otherwise the stored ISBN is an arbitrary one of every printing.
    expect(searchFields).toContain('editions.isbn')
    expect(subjectFields).not.toContain('editions.isbn')
  })

  it('asks for the alternate author names, which is where an English one comes from', async () => {
    const { ol } = await load()

    const search = ol.searchBooks('dostoevsky')
    await vi.advanceTimersByTimeAsync(5000)
    await search

    const author = ol.fetchByAuthor('Le Guin')
    await vi.advanceTimersByTimeAsync(5000)
    await author

    const subject = ol.fetchSubject('science fiction')
    await vi.advanceTimersByTimeAsync(5000)
    await subject

    // Drop it and every translated author reverts to the original script.
    expect(urls).toHaveLength(3)
    for (const url of urls) {
      const fields = new URL(url).searchParams.get('fields') ?? ''
      expect(fields.split(',')).toContain('author_alternative_name')
    }
  })

  it('reaches the author harvest too, not just search', async () => {
    const { harvest } = await load()
    const book = books.createBook(db, {
      title: 'Solaris',
      author: 'Stanisław Lem',
      status: 'read',
      rating: 5
    })
    saveBookMetadata(db, book.id, { subjects: ['science fiction'], description: null })

    const done = harvest.harvestCandidates(db)
    await vi.advanceTimersByTimeAsync(60_000)
    await done

    const searches = urls.filter((url) => url.includes('/search.json'))
    expect(searches.length).toBeGreaterThan(1)
    for (const url of searches) expect(url).toContain('language=eng')
  })
})
