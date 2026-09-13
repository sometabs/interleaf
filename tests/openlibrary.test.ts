import { afterEach, describe, expect, it, vi } from 'vitest'

import { downloadCover, toOlBook } from '../src/main/services/openlibrary'

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

// Edition language is explicit. The API filters works to English, then this
// mapper keeps the selected edition's fields together.
describe('choosing between the work and edition titles', () => {
  function titleOf(work: string, edition?: string): string | undefined {
    return toOlBook({
      key: '/works/OL1W',
      title: work,
      ...(edition === undefined ? {} : { editions: { docs: [{ title: edition }] } })
    })?.title
  }

  it('takes the edition when the work title is in another language', () => {
    expect(titleOf('Преступление и наказание', 'Crime and punishment')).toBe('Crime and punishment')
    expect(titleOf('Записки изъ подполья', 'Notes from Underground')).toBe('Notes from Underground')
    expect(
      titleOf(
        'Am Ufer des Rio Piedra saß ich und weinte',
        'By the River Piedra I Sat Down and Wept'
      )
    ).toBe('By the River Piedra I Sat Down and Wept')
  })

  it('falls back to Open Library’s default edition when none is readable', () => {
    const book = toOlBook({
      key: '/works/OL1W',
      title: 'A work title',
      cover_i: 10,
      editions: { docs: [{ title: 'Un titre français', cover_i: 20, language: ['fre'] }] }
    })

    expect(book).toMatchObject({ title: 'Un titre français', coverId: 20 })
  })

  it('prefers a readable edition even when it is not listed first', () => {
    const book = toOlBook({
      key: '/works/OL1W',
      title: 'Un titre français',
      editions: {
        docs: [
          { title: 'Un titre français', cover_i: 10, language: ['fre'] },
          { title: 'An English title', cover_i: 20, language: ['eng'] }
        ]
      }
    })

    expect(book).toMatchObject({ title: 'An English title', coverId: 20 })
  })

  it('takes a nested edition explicitly marked as English', () => {
    const book = toOlBook({
      key: '/works/OL1W',
      title: 'Un titre français',
      editions: { docs: [{ title: 'An English title', cover_i: 20, language: ['eng'] }] }
    })

    expect(book).toMatchObject({ title: 'An English title', coverId: 20 })
  })

  it('takes the edition for a foreign title that no character test would catch', () => {
    // Plain ASCII, which is why language detection was rejected.
    expect(titleOf('Il nome della rosa', 'The name of the rose')).toBe('The name of the rose')
    expect(titleOf('O Alquimista', 'The Alchemist')).toBe('The Alchemist')
    expect(titleOf('Le petit prince', 'El Principito / The Little Prince')).toBe(
      'El Principito / The Little Prince'
    )
  })

  it('keeps the selected edition title even when it adds series information', () => {
    expect(titleOf('Children of Dune', 'Children of Dune (Dune Chronicles, Book 3)')).toBe(
      'Children of Dune (Dune Chronicles, Book 3)'
    )
    expect(titleOf('Fyodor Dostoevsky', 'Fyodor Dostoevsky.')).toBe('Fyodor Dostoevsky.')
  })

  it('uses the selected edition’s exact capitalization', () => {
    expect(
      titleOf('Great Short Works of Fyodor Dostoevsky', 'Great short works of Fyodor Dostoevsky')
    ).toBe('Great short works of Fyodor Dostoevsky')
  })

  it('needs every word, not merely an overlap', () => {
    // "prince" is in both, "petit" is not: a partial match must not count.
    expect(titleOf('Le petit prince', 'The Little Prince')).toBe('The Little Prince')
  })

  it('falls back to the work title when no edition came back', () => {
    expect(titleOf('L’étranger')).toBe('L’étranger')
    expect(titleOf('L’étranger', '   ')).toBe('L’étranger')
  })

  it('takes the edition when the work title is only punctuation', () => {
    // An empty word list vacuously satisfies "every word appears".
    expect(titleOf('...', 'The Waste Land')).toBe('The Waste Land')
  })

  it('reports the work and selected edition ids separately', () => {
    const book = toOlBook({
      key: '/works/OL796473W',
      title: 'Преступление и наказание',
      editions: { docs: [{ key: '/books/OL123M', title: 'Crime and punishment' }] }
    })

    expect(book?.olid).toBe('OL796473W')
    expect(book?.editionOlid).toBe('OL123M')
    expect(book?.title).toBe('Crime and punishment')
  })

  it('takes year and page count from the selected edition', () => {
    const book = toOlBook({
      key: '/works/OL1W',
      title: 'A work',
      first_publish_year: 1942,
      number_of_pages_median: 999,
      editions: {
        docs: [
          {
            title: 'An English edition',
            language: ['eng'],
            publish_date: 'May 1991',
            number_of_pages: 224
          }
        ]
      }
    })

    expect(book).toMatchObject({ publishedYear: 1991, pageCount: 224 })
  })
})

// Cover and title must come from the same source, or a book gets one
// printing's name over another's jacket.
describe('the cover that goes with the title', () => {
  function shown(doc: Parameters<typeof toOlBook>[0]): { title?: string; coverId?: number | null } {
    const book = toOlBook({ key: '/works/OL1W', ...doc })
    return { title: book?.title, coverId: book?.coverId }
  }

  // A work's `isbn` lists every edition's unordered, so `isbn[0]` is arbitrary.
  describe('and the ISBN, which is the same question', () => {
    function isbnOf(doc: Parameters<typeof toOlBook>[0]): string | null | undefined {
      return toOlBook({ key: '/works/OL1W', ...doc })?.isbn
    }

    it('takes the edition’s ISBN when it takes the edition’s title', () => {
      expect(
        isbnOf({
          title: 'Сон смешного человека',
          isbn: ['152870827X', '9781520000000'],
          editions: {
            docs: [
              { title: 'The Dream Of A Ridiculous Man', isbn: ['9781419160226', '1419160222'] }
            ]
          }
        })
      ).toBe('9781419160226')
    })

    it('uses the selected edition’s ISBN even when its title is similar', () => {
      expect(
        isbnOf({
          title: 'Children of Dune',
          isbn: ['0441104029'],
          editions: { docs: [{ title: 'Children of Dune (Dune Chronicles, Book 3)', isbn: ['X'] }] }
        })
      ).toBe('X')
    })

    it('reports none rather than a different printing’s', () => {
      expect(
        isbnOf({
          title: 'Преступление и наказание',
          isbn: ['0140449132'],
          editions: { docs: [{ title: 'Crime and punishment' }] }
        })
      ).toBeNull()
    })
  })

  it('takes the edition’s cover when it takes the edition’s title', () => {
    expect(
      shown({
        title: 'Сон смешного человека',
        cover_i: 2682490,
        editions: { docs: [{ title: 'The Dream Of A Ridiculous Man', cover_i: 763393 }] }
      })
    ).toEqual({ title: 'The Dream Of A Ridiculous Man', coverId: 763393 })
  })

  it('uses the selected edition’s cover with its title', () => {
    expect(
      shown({
        title: 'Children of Dune',
        cover_i: 111,
        editions: { docs: [{ title: 'Children of Dune (Dune Chronicles, Book 3)', cover_i: 222 }] }
      })
    ).toEqual({ title: 'Children of Dune (Dune Chronicles, Book 3)', coverId: 222 })
  })

  it('keeps the work’s cover when no edition came back at all', () => {
    expect(shown({ title: 'L’étranger', cover_i: 333 })).toEqual({
      title: 'L’étranger',
      coverId: 333
    })
  })

  // No cover beats a different printing's cover.
  it('shows no cover rather than the wrong one', () => {
    expect(
      shown({
        title: 'Преступление и наказание',
        cover_i: 999,
        editions: { docs: [{ title: 'Crime and punishment' }] }
      })
    ).toEqual({ title: 'Crime and punishment', coverId: null })
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
