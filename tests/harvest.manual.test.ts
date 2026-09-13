import type { Database } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDatabase } from '../src/main/db/database'
import * as books from '../src/main/repos/books'
import { getBookMetadata, saveBookMetadata } from '../src/main/repos/metadata'

let db: Database
let searched: string[] = []

function installFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = String(input)
      searched.push(url)
      const body = url.includes('/works/')
        ? { title: 'A work', subjects: ['science fiction'], covers: [7] }
        : {
            docs: [
              {
                key: '/works/OL999W',
                title: 'Something Else Entirely',
                author_name: ['Someone Else'],
                cover_i: 2,
                subject: ['science fiction'],
                language: ['eng']
              }
            ]
          }
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

async function load(): Promise<typeof import('../src/main/services/harvest')> {
  vi.resetModules()
  return import('../src/main/services/harvest')
}

beforeEach(() => {
  searched = []
  db = createDatabase(':memory:')
  vi.useFakeTimers()
  installFetch()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function refresh(): Promise<void> {
  const { harvestCandidates } = await load()
  const done = harvestCandidates(db)
  await vi.advanceTimersByTimeAsync(30000)
  await done
}

describe('a book added by hand', () => {
  it('is never enriched by a harvest', async () => {
    const book = books.createBook(db, {
      title: 'Qwerty Nonsense Title',
      status: 'read',
      rating: 5
    })

    await refresh()

    expect(books.getBook(db, book.id)?.olid).toBeNull()
    expect(getBookMetadata(db, book.id)).toBeNull()
  })

  it('does not spend a request looking itself up', async () => {
    books.createBook(db, { title: 'Qwerty Nonsense Title', status: 'read', rating: 5 })

    await refresh()

    expect(searched.some((url) => url.includes('Qwerty'))).toBe(false)
  })

  it('does not turn recommendation search into a metadata refresh', async () => {
    const book = books.createBook(db, {
      title: 'Solaris',
      olid: 'OL123W',
      status: 'read',
      rating: 5
    })

    await refresh()

    expect(getBookMetadata(db, book.id)).toBeNull()
    expect(searched).toEqual([])
  })

  it('counts once its metadata has been fetched deliberately', async () => {
    const book = books.createBook(db, {
      title: 'Qwerty Nonsense Title',
      status: 'read',
      rating: 5
    })
    saveBookMetadata(db, book.id, {
      subjects: ['science fiction'],
      description: null,
      raw: null
    })

    await refresh()

    expect(searched.some((url) => url.includes('subject'))).toBe(true)
  })
})
