import { afterEach, describe, expect, it, vi } from 'vitest'

import { checkAvailability, downloadCover, toOlBook } from '../src/main/services/openlibrary'

// Fixtures are trimmed from real /search.json responses.

const searchDoc = {
  key: '/works/OL27448W',
  title: 'The Dispossessed',
  author_name: ['Ursula K. Le Guin'],
  first_publish_year: 1974,
  cover_i: 13617691,
  isbn: ['9780061054884'],
  number_of_pages_median: 341,
  subject: ['Utopias', 'Anarchism'],
  language: ['eng', 'fre', 'ger']
}

describe('toOlBook', () => {
  it('reads a search result', () => {
    const book = toOlBook(searchDoc)

    expect(book).toMatchObject({
      olid: 'OL27448W',
      title: 'The Dispossessed',
      author: 'Ursula K. Le Guin',
      coverId: 13617691,
      pageCount: 341
    })
  })

  it('carries the language list a search reports', () => {
    expect(toOlBook(searchDoc)?.languages).toEqual(['eng', 'fre', 'ger'])
  })

  it('keeps a first sentence as candidate text', () => {
    expect(
      toOlBook({
        key: '/works/OL1W',
        title: 'A book',
        first_sentence: ['A philosopher questions inherited morality.']
      })?.description
    ).toBe('A philosopher questions inherited morality.')
  })

  it('keeps every subject exactly as Open Library returned it', () => {
    const filing = Array.from({ length: 45 }, (_, index) => `award:prize=${index}`)
    const book = toOlBook({
      key: '/works/OL1W',
      title: 'A book',
      subject: [...filing, 'Philosophy', 'Ethics']
    })

    expect(book?.subjects).toEqual([...filing, 'Philosophy', 'Ethics'])
  })

  it('reports no languages when the response carries none', () => {
    expect(toOlBook({ key: '/works/OL1W', title: 'Bare' })?.languages).toEqual([])
  })

  it('strips the /works/ prefix', () => {
    expect(toOlBook(searchDoc)?.olid).toBe('OL27448W')
  })

  it('returns null without a key or a title', () => {
    expect(toOlBook({ title: 'No key' })).toBeNull()
    expect(toOlBook({ key: '/works/OL1W' })).toBeNull()
  })

  it('reports a missing cover or author as null, not undefined', () => {
    const book = toOlBook({ key: '/works/OL1W', title: 'Bare' })

    expect(book?.coverId).toBeNull()
    expect(book?.author).toBeNull()
  })

  it('treats a blank author name as no author', () => {
    expect(toOlBook({ key: '/works/OL1W', title: 'Bare', author_name: ['  '] })?.author).toBeNull()
  })
})

// Open Library files a translated writer under their original script; the
// Latin spelling exists only in author_alternative_name.
describe('the author a search result is credited to', () => {
  it('shows a Cyrillic author in the spelling on the English cover', () => {
    const book = toOlBook({
      key: '/works/OL166882W',
      title: 'Сон смешного человека',
      author_name: ['Фёдор Михайлович Достоевский'],
      author_alternative_name: [
        'Fyodor Dostoyevsky',
        'Fyodor Dostoyevsky',
        'Fédor Dostoïevski',
        'F. M. Dostoevskij',
        'Dostoyevsky, Fyodor'
      ]
    })

    expect(book?.author).toBe('Fyodor Dostoyevsky')
  })

  it('leaves an author who is already Latin untouched', () => {
    const book = toOlBook({
      key: '/works/OL1W',
      title: 'Dune',
      author_name: ['Frank Herbert'],
      author_alternative_name: ['Herbert Frank', 'FRANK HERBERT', 'Frank Patrick Herbert']
    })

    expect(book?.author).toBe('Frank Herbert')
  })
})

// Open Library's search page combines its selected edition's visible identity
// with work-level values such as the first publication year.
describe('work and nested edition metadata', () => {
  it('uses the edition title and cover with the work publication year', () => {
    const book = toOlBook({
      key: '/works/OL1W',
      title: 'Twilight of the Idols',
      cover_i: 111,
      first_publish_year: 1911,
      editions: {
        docs: [
          {
            key: '/books/OL123M',
            title: 'Twilight of the Idols: A New Translation',
            cover_i: 222,
            publish_date: '2007'
          }
        ]
      }
    })

    expect(book).toMatchObject({
      title: 'Twilight of the Idols: A New Translation',
      coverId: 222,
      publishedYear: 1911,
      editionOlid: 'OL123M'
    })
  })

  it('keeps edition-specific metadata together but prefers the work page median', () => {
    const book = toOlBook({
      key: '/works/OL893414W',
      title: 'Dune',
      isbn: ['9780441172719'],
      number_of_pages_median: 608,
      language: ['eng', 'fre'],
      editions: {
        docs: [
          {
            key: '/books/OL7500941M',
            isbn: ['9780000000000'],
            number_of_pages: 224,
            language: ['spa']
          }
        ]
      }
    })

    expect(book).toMatchObject({
      editionOlid: 'OL7500941M',
      isbn: '9780000000000',
      pageCount: 608,
      languages: ['spa']
    })
  })

  it('uses nested edition fallbacks only when the work omits them', () => {
    const book = toOlBook({
      key: '/works/OL1W',
      title: 'A work',
      editions: {
        docs: [
          {
            key: '/books/OL456M',
            isbn: ['9780000000000'],
            number_of_pages: 224,
            language: ['eng']
          }
        ]
      }
    })

    expect(book).toMatchObject({
      editionOlid: 'OL456M',
      isbn: '9780000000000',
      pageCount: 224,
      languages: ['eng']
    })
  })
})

// The id reaches this as an IPC argument, so `number` says nothing at runtime
// and `../` in it would rewrite the request path.
describe('downloadCover id validation', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    ['a traversal string', '../../../evil'],
    ['a numeric string', '13617691'],
    ['a float', 1.5],
    ['zero', 0],
    ['a negative', -1],
    ['NaN', NaN]
  ])('refuses %s without making a request', async (_label, value) => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await expect(downloadCover(value as unknown as number)).resolves.toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('requests the canonical cover url for a real id', async () => {
    const bytes = Buffer.alloc(2000, 1)
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => bytes.buffer.slice(0, bytes.byteLength)
    })
    vi.stubGlobal('fetch', fetchSpy)

    await expect(downloadCover(13617691, 'M')).resolves.not.toBeNull()
    expect(fetchSpy.mock.calls[0][0]).toBe('https://covers.openlibrary.org/b/id/13617691-M.jpg')
  })
})

describe('Open Library availability check', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses one small Search API request', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchSpy)

    await expect(checkAvailability()).resolves.toBe(true)

    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(fetchSpy.mock.calls[0][0]).toContain('/search.json?')
    expect(fetchSpy.mock.calls[0][0]).toContain('limit=1&fields=key')
  })
})
