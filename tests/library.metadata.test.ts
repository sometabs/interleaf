import type { Database } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDatabase } from '../src/main/db/database'
import * as books from '../src/main/repos/books'
import { getBookMetadata, saveBookMetadata } from '../src/main/repos/metadata'

let db: Database

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 404 ? 'Not Found' : 'OK',
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

describe('adding from Open Library', () => {
  it('saves the selected result without searching for another edition', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      void input
      return response({
        title: 'A different work title',
        subjects: ['Sparse work subject'],
        description: 'The complete description.'
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { addFromOpenLibrary } = await import('../src/main/services/library')

    const pending = addFromOpenLibrary(db, {
      olid: 'OL1W',
      editionOlid: 'OL10M',
      title: 'The selected title',
      author: 'Selected Author',
      publishedYear: 1984,
      coverId: null,
      isbn: 'selected-isbn',
      pageCount: 321,
      subjects: ['Search subject']
    })
    await vi.advanceTimersByTimeAsync(5_000)
    const book = await pending

    expect(book).toMatchObject({
      olid: 'OL1W',
      editionOlid: 'OL10M',
      title: 'The selected title',
      author: 'Selected Author',
      isbn: 'selected-isbn',
      pageCount: 321,
      publishedYear: 1984
    })
    expect(getBookMetadata(db, book.id)).toMatchObject({
      subjects: ['Search subject'],
      description: 'The complete description.'
    })
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      'https://openlibrary.org/works/OL1W.json'
    ])
  })

  it('looks identical after an immediate metadata refresh', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        if (String(input).includes('/search.json')) {
          return response({
            docs: [
              {
                key: '/works/OL1W',
                title: 'A different work title',
                author_name: ['Different Author'],
                first_publish_year: 1900,
                number_of_pages_median: 999,
                editions: {
                  docs: [
                    {
                      key: '/books/OL99M',
                      title: 'A different edition',
                      cover_i: 999,
                      isbn: ['different-isbn']
                    }
                  ]
                }
              }
            ]
          })
        }
        return response({ subjects: ['Updated subject'], description: 'Updated description.' })
      })
    )
    const { addFromOpenLibrary, refreshOneBookMetadata } =
      await import('../src/main/services/library')

    const adding = addFromOpenLibrary(db, {
      olid: 'OL1W',
      editionOlid: 'OL10M',
      title: 'The selected title',
      author: 'Selected Author',
      publishedYear: 1984,
      coverId: null,
      isbn: 'selected-isbn',
      pageCount: 321,
      subjects: ['Original subject']
    })
    await vi.advanceTimersByTimeAsync(5_000)
    const added = await adding

    const refreshing = refreshOneBookMetadata(db, added.id)
    await vi.advanceTimersByTimeAsync(8_000)
    const refreshed = await refreshing

    expect(refreshed).toMatchObject({
      olid: 'OL1W',
      editionOlid: 'OL10M',
      title: 'The selected title',
      author: 'Selected Author',
      isbn: 'selected-isbn',
      pageCount: 321,
      publishedYear: 1984,
      coverPath: null
    })
    expect(getBookMetadata(db, added.id)).toMatchObject({
      subjects: ['Updated subject'],
      description: 'Updated description.'
    })
  })
})

describe('refreshing the whole library', () => {
  it('reports a missing Work without treating Open Library as offline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        if (String(input).includes('/works/')) return response({}, 404)
        return response({
          docs: [
            {
              key: '/works/OL1W',
              title: 'A deleted work',
              number_of_pages_median: 200
            }
          ]
        })
      })
    )
    const { refreshAllBookMetadata } = await import('../src/main/services/library')
    const original = books.createBook(db, { title: 'A deleted work', olid: 'OL1W' })

    const pending = refreshAllBookMetadata(db)
    await vi.advanceTimersByTimeAsync(5_000)
    const result = await pending

    expect(result).toEqual({
      refreshed: 0,
      failures: [
        {
          bookId: original.id,
          title: 'A deleted work',
          reason: 'Open Library no longer has this Work ID.'
        }
      ],
      cancelled: false,
      offline: false
    })
    expect(books.getBook(db, original.id)?.pageCount).toBeNull()
  })

  it('refreshes by Work ID without requesting or selecting an edition', async () => {
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
      title: 'The Hobbit',
      author: 'J. R. R. Tolkien',
      olid: 'OL27482W',
      editionOlid: null
    })
    const searchUrl = fetchMock.mock.calls
      .map(([input]) => String(input))
      .find((url) => url.includes('/search.json'))
    const parsed = new URL(searchUrl ?? '')
    expect(parsed.searchParams.get('q')).toBe('key:/works/OL27482W')
    expect(parsed.searchParams.get('fields')?.split(',')).not.toContain('editions')
  })

  it('fills missing work fields without adopting nested-edition identity', async () => {
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
            number_of_pages_median: 176,
            first_publish_year: 2016,
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
      title: 'Convenience Store Woman',
      author: 'Sayaka Murata',
      editionOlid: null,
      isbn: null,
      pageCount: 176,
      publishedYear: 2016
    })
    const searchUrl = fetchMock.mock.calls
      .map(([input]) => String(input))
      .find((url) => url.includes('/search.json'))
    expect(new URL(searchUrl ?? '').searchParams.get('q')).toBe('key:/works/OL19744024W')
  })

  it('refreshes metadata while preserving the selected edition and visible fields', async () => {
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
              first_publish_year: 2005,
              number_of_pages_median: 144,
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
      finishedAt: 200,
      coverPath: `book-${original.id}-123.jpg`
    })

    const pending = refreshAllBookMetadata(db)
    await vi.advanceTimersByTimeAsync(5_000)
    const result = await pending

    expect(result).toEqual({ refreshed: 1, failures: [], cancelled: false, offline: false })
    expect(books.getBook(db, original.id)).toMatchObject({
      title: 'The Myth of Sisyphus',
      author: 'Albert Camus',
      olid: 'OL1W',
      editionOlid: 'OL1M',
      isbn: 'old-isbn',
      pageCount: 144,
      publishedYear: 2005,
      coverPath: `book-${original.id}-123.jpg`,
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

  it('does not erase stored metadata when a refresh response is sparse', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        if (String(input).includes('/works/')) return response({ covers: [456] })
        return response({
          docs: [
            {
              key: '/works/OL1W',
              title: 'Existing title',
              first_publish_year: 2020,
              number_of_pages_median: 999,
              editions: { docs: [{ key: '/books/OL2M', title: 'Existing title' }] }
            }
          ]
        })
      })
    )
    const { refreshOneBookMetadata } = await import('../src/main/services/library')
    const original = books.createBook(db, {
      title: 'Existing title',
      author: 'Existing author',
      olid: 'OL1W',
      editionOlid: 'OL1M',
      isbn: 'existing-isbn',
      pageCount: 200,
      publishedYear: 1999
    })
    books.updateBook(db, original.id, { coverPath: `book-${original.id}-123.jpg` })
    saveBookMetadata(db, original.id, {
      subjects: ['Existing subject'],
      description: 'Existing description.'
    })

    const pending = refreshOneBookMetadata(db, original.id)
    await vi.advanceTimersByTimeAsync(5_000)
    await pending

    expect(books.getBook(db, original.id)).toMatchObject({
      author: 'Existing author',
      isbn: 'existing-isbn',
      pageCount: 200,
      publishedYear: 1999,
      coverPath: `book-${original.id}-123.jpg`
    })
    expect(getBookMetadata(db, original.id)).toMatchObject({
      subjects: ['Existing subject'],
      description: 'Existing description.'
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
    expect(result.failures[0]?.reason).toBe('Open Library returned no result for this book.')
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
