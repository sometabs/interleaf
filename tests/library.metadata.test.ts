import type { Database } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDatabase } from '../src/main/db/database'
import * as books from '../src/main/repos/books'
import { getBookMetadata } from '../src/main/repos/metadata'

let db: Database

function response(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0)
  } as unknown as Response
}

beforeEach(() => {
  db = createDatabase(':memory:')
  vi.useFakeTimers()
  vi.resetModules()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('choosing shelf metadata', () => {
  it('keeps search subjects instead of replacing them with a sparse work record', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) =>
        String(input).includes('/works/')
          ? response({ subjects: ['Continental drama'], description: 'A work description.' })
          : response({ docs: [] })
      )
    )
    const { addFromOpenLibrary } = await import('../src/main/services/library')

    const done = addFromOpenLibrary(db, {
      olid: 'OL1W',
      title: 'Beyond Good and Evil',
      author: 'Friedrich Nietzsche',
      publishedYear: 1886,
      coverId: null,
      isbn: null,
      pageCount: null,
      subjects: ['Philosophy', 'Ethics']
    })
    await vi.advanceTimersByTimeAsync(5_000)
    const book = await done

    expect(getBookMetadata(db, book.id)).toMatchObject({
      subjects: ['Philosophy', 'Ethics'],
      description: 'A work description.'
    })
  })

  it('repairs an older sparse record from the matching search result', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.includes('/works/')) {
        return response({ subjects: ['Continental drama'], covers: [] })
      }
      return response({
        docs: [
          {
            key: '/works/OL1W',
            title: 'Beyond Good and Evil',
            author_name: ['Friedrich Nietzsche'],
            subject: ['Philosophy', 'Ethics'],
            language: ['eng']
          }
        ]
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { enrich } = await import('../src/main/services/library')
    const book = books.createBook(db, {
      title: 'Beyond Good and Evil',
      author: 'Friedrich Nietzsche',
      olid: 'OL1W'
    })

    const done = enrich(db, book.id)
    await vi.advanceTimersByTimeAsync(5_000)
    await done

    expect(getBookMetadata(db, book.id)?.subjects).toEqual(['Philosophy', 'Ethics'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not replace a stored work with a richer duplicate', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      if (String(input).includes('/works/')) return response({ subjects: [] })
      return response({
        docs: [
          {
            key: '/works/OL1161325W',
            title: "L'être et le néant",
            author_name: ['Jean-Paul Sartre'],
            subject: ['Existentialism', 'Ontology', 'Philosophy'],
            language: ['eng', 'fre'],
            editions: {
              docs: [
                {
                  key: '/books/OL51699762M',
                  title: 'Being and Nothingness',
                  cover_i: 14882069,
                  language: ['eng']
                }
              ]
            }
          }
        ]
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { enrich } = await import('../src/main/services/library')
    const book = books.createBook(db, {
      title: 'Being and Nothingness',
      author: 'Jean-Paul Sartre',
      olid: 'OL38060433W',
      isbn: '9781973776659'
    })

    const done = enrich(db, book.id)
    await vi.advanceTimersByTimeAsync(5_000)
    await done

    const saved = books.getBook(db, book.id)
    expect(saved).toMatchObject({
      olid: 'OL38060433W',
      editionOlid: null,
      isbn: '9781973776659'
    })
    expect(getBookMetadata(db, book.id)?.subjects).toEqual([])

    const searchUrl = fetchMock.mock.calls
      .map(([input]) => String(input))
      .find((url) => url.includes('/search.json'))
    expect(new URL(searchUrl ?? '').searchParams.get('q')).toBe(
      'title:"Being and Nothingness" author:"Jean-Paul Sartre"'
    )
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/b/id/'))).toBe(false)
  })

  it('keeps a sparse work instead of silently rebinding its OLID', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        if (String(input).includes('/works/')) return response({ subjects: ['Continental drama'] })
        return response({
          docs: [
            {
              key: '/works/OL2W',
              title: 'Beyond Good and Evil',
              author_name: ['Friedrich Nietzsche'],
              subject: ['Philosophy', 'Ethics', 'Good and evil'],
              language: ['eng']
            }
          ]
        })
      })
    )
    const { enrich } = await import('../src/main/services/library')
    const book = books.createBook(db, {
      title: 'Beyond Good and Evil',
      author: 'Friedrich Nietzsche',
      olid: 'OL1W'
    })

    const done = enrich(db, book.id)
    await vi.advanceTimersByTimeAsync(5_000)
    await done

    expect(books.getBook(db, book.id)?.olid).toBe('OL1W')
    expect(getBookMetadata(db, book.id)?.subjects).toEqual(['Continental drama'])
  })

  it('does not turn a one-word title into a sequel with a similar name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        if (String(input).includes('/works/')) return response({ subjects: ['Fiction'] })
        return response({
          docs: [
            {
              key: '/works/OL2W',
              title: 'Dune Messiah',
              author_name: ['Frank Herbert'],
              subject: ['Science fiction', 'Dystopias', 'Space opera'],
              language: ['eng']
            }
          ]
        })
      })
    )
    const { enrich } = await import('../src/main/services/library')
    const book = books.createBook(db, { title: 'Dune', author: 'Frank Herbert', olid: 'OL1W' })

    const done = enrich(db, book.id)
    await vi.advanceTimersByTimeAsync(5_000)
    await done

    expect(books.getBook(db, book.id)?.olid).toBe('OL1W')
    expect(getBookMetadata(db, book.id)?.subjects).toEqual(['Fiction'])
  })
})

describe('refreshing the whole library', () => {
  it('refreshes the stored work without re-identifying it from title or author text', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.includes('/works/')) return response({ subjects: ['Fantasy'] })
      return response({
        docs: [
          {
            key: '/works/OL27482W',
            title: 'The Hobbit',
            author_name: ['J.R.R. Tolkien'],
            subject: ['Fantasy'],
            language: ['eng'],
            editions: {
              docs: [
                {
                  key: '/books/OL51709286M',
                  title: 'The Hobbit',
                  language: ['eng']
                }
              ]
            }
          }
        ]
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { refreshOneBookMetadata } = await import('../src/main/services/library')
    const original = books.createBook(db, {
      title: 'The Hobbit',
      author: 'J. R. R. Tolkien',
      olid: 'OL27482W'
    })

    const pending = refreshOneBookMetadata(db, original.id)
    await vi.advanceTimersByTimeAsync(7_000)
    await pending

    expect(books.getBook(db, original.id)).toMatchObject({
      author: 'J.R.R. Tolkien',
      editionOlid: 'OL51709286M'
    })
    const queries = fetchMock.mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.includes('/search.json'))
      .map((url) => new URL(url).searchParams.get('q'))
    expect(queries).toEqual(['key:/works/OL27482W'])
  })

  it('uses the English edition and Latin author returned for that exact work', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.includes('/works/')) return response({ subjects: ['Fiction'] })
      return response({
        docs: [
          {
            key: '/works/OL19744024W',
            title: 'Convenience store woman',
            author_name: ['村田沙耶香'],
            author_alternative_name: ['Murata Sayaka', 'Sayaka Murata', 'MURATA SAYAKA'],
            subject: ['Fiction'],
            language: ['eng'],
            editions: {
              docs: [
                {
                  key: '/books/OL28719876M',
                  title: 'Convenience Store Woman',
                  language: ['eng'],
                  isbn: ['9781846276842']
                }
              ]
            }
          }
        ]
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { refreshOneBookMetadata } = await import('../src/main/services/library')
    const original = books.createBook(db, {
      title: 'Convenience Store Woman',
      author: 'Sayaka Murata',
      olid: 'OL19744024W'
    })

    const pending = refreshOneBookMetadata(db, original.id)
    await vi.advanceTimersByTimeAsync(7_000)
    await pending

    expect(books.getBook(db, original.id)).toMatchObject({
      author: 'Murata Sayaka',
      editionOlid: 'OL28719876M',
      isbn: '9781846276842'
    })
    const searchUrl = fetchMock.mock.calls
      .map(([input]) => String(input))
      .find((url) => url.includes('/search.json'))
    expect(new URL(searchUrl ?? '').searchParams.get('q')).toBe('key:/works/OL19744024W')
  })

  it('rebuilds Open Library fields while preserving reader-owned fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        if (String(input).includes('/works/')) {
          return response({ description: 'The complete description.', subjects: ['Work subject'] })
        }
        return response({
          docs: [
            {
              key: '/works/OL1W',
              title: 'Old title',
              author_name: ['Albert Camus'],
              author_alternative_name: ['Camus, Albert'],
              subject: ['Philosophy', 'Absurdism'],
              language: ['eng'],
              editions: {
                docs: [
                  {
                    key: '/books/OL2M',
                    title: 'The Myth of Sisyphus',
                    isbn: ['9780141023991'],
                    language: ['eng'],
                    number_of_pages: 144,
                    publish_date: '2005'
                  }
                ]
              }
            }
          ]
        })
      })
    )
    const { refreshAllBookMetadata } = await import('../src/main/services/library')
    const original = books.createBook(db, {
      title: 'The Myth of Sisyphus',
      author: 'Albert Camus',
      olid: 'OL1W',
      editionOlid: 'OL1M',
      isbn: 'old-isbn',
      status: 'read',
      rating: 5
    })
    books.updateBook(db, original.id, {
      genres: ['Philosophy'],
      startedAt: 100,
      finishedAt: 200
    })

    const pending = refreshAllBookMetadata(db)
    await vi.advanceTimersByTimeAsync(5_000)
    const result = await pending

    expect(result).toEqual({ refreshed: 1, failures: [], cancelled: false, offline: false })
    expect(books.getBook(db, original.id)).toMatchObject({
      title: 'The Myth of Sisyphus',
      author: 'Albert Camus',
      olid: 'OL1W',
      editionOlid: 'OL2M',
      isbn: '9780141023991',
      pageCount: 144,
      publishedYear: 2005,
      status: 'read',
      rating: 5,
      genres: ['Philosophy'],
      startedAt: 100,
      finishedAt: 200
    })
    expect(getBookMetadata(db, original.id)).toMatchObject({
      subjects: ['Philosophy', 'Absurdism'],
      description: 'The complete description.'
    })
  })

  it('does not migrate a stored work id through a title search', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ docs: [] }))
    )
    const { refreshAllBookMetadata } = await import('../src/main/services/library')
    const original = books.createBook(db, {
      title: 'Being and Nothingness',
      author: 'Jean-Paul Sartre',
      olid: 'OL999W'
    })

    const pending = refreshAllBookMetadata(db)
    await vi.advanceTimersByTimeAsync(5_000)
    const result = await pending

    expect(result.refreshed).toBe(0)
    expect(result.failures[0]?.reason).toBe('No English edition was found.')
    expect(books.getBook(db, original.id)?.olid).toBe('OL999W')
  })

  it('reports a current book that has no stored Work ID', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { refreshAllBookMetadata } = await import('../src/main/services/library')
    const original = books.createBook(db, {
      title: 'Dune',
      author: 'Frank Herbert',
      isbn: 'keep-me'
    })

    const pending = refreshAllBookMetadata(db)
    await vi.advanceTimersByTimeAsync(5_000)
    const result = await pending

    expect(result.refreshed).toBe(0)
    expect(result.failures).toEqual([
      {
        bookId: original.id,
        title: 'Dune',
        reason: 'This book has no Open Library Work ID.'
      }
    ])
    expect(books.getBook(db, original.id)).toMatchObject({ olid: null, isbn: 'keep-me' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
