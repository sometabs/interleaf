import type { Database } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDatabase } from '../src/main/db/database'
import * as books from '../src/main/repos/books'
import { saveBookMetadata } from '../src/main/repos/metadata'

// Open Library allows 1 request/second for unidentified clients and may block
// violations, so these assert on when requests actually went out.

interface Call {
  url: string
  at: number
}

let calls: Call[] = []

// Milliseconds between consecutive requests, in order.
function gaps(): number[] {
  return calls.slice(1).map((call, i) => call.at - calls[i].at)
}

function apiCalls(): Call[] {
  return calls.filter((call) => call.url.startsWith('https://openlibrary.org'))
}

function installFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = String(input)
      calls.push({ url, at: Date.now() })

      const body = url.includes('/subjects/')
        ? { works: [{ key: '/works/OL1W', title: 'Subject work', cover_id: 1 }] }
        : url.includes('/works/')
          ? { title: 'A work', subjects: ['utopias'], covers: [7] }
          : { docs: [{ key: '/works/OL2W', title: 'Search hit', cover_i: 2 }] }

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

// A fresh module per test: the throttle keeps `lastStart` in module scope.
async function loadOpenLibrary(): Promise<typeof import('../src/main/services/openlibrary')> {
  vi.resetModules()
  return import('../src/main/services/openlibrary')
}

beforeEach(() => {
  calls = []
  vi.useFakeTimers()
  installFetch()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('outbound request spacing', () => {
  it('spaces the two calls that adding a book makes', async () => {
    const ol = await loadOpenLibrary()

    const done = (async () => {
      await ol.searchBooks('the dispossessed')
      await ol.fetchWork('OL27448W')
    })()
    await vi.advanceTimersByTimeAsync(20_000)
    await done

    expect(apiCalls()).toHaveLength(2)
    expect(Math.min(...gaps())).toBeGreaterThanOrEqual(1100)
  })

  it('serialises a burst fired all at once', async () => {
    const ol = await loadOpenLibrary()

    const done = Promise.all([
      ol.searchBooks('a'.repeat(3)),
      ol.searchBooks('b'.repeat(3)),
      ol.searchBooks('c'.repeat(3)),
      ol.searchBooks('d'.repeat(3)),
      ol.searchBooks('e'.repeat(3))
    ])
    await vi.advanceTimersByTimeAsync(60_000)
    await done

    expect(apiCalls()).toHaveLength(5)
    expect(Math.min(...gaps())).toBeGreaterThanOrEqual(1100)
  })

  it('spaces a harvest-shaped fan-out of subjects and authors', async () => {
    const ol = await loadOpenLibrary()

    const done = (async () => {
      for (const subject of ['utopias', 'anarchism', 'sf', 'politics', 'ethics', 'gender']) {
        await ol.fetchSubject(subject, 24)
      }
      for (const author of ['Le Guin', 'Butler', 'Delany', 'Russ']) {
        await ol.fetchByAuthor(author, 16)
      }
    })()
    await vi.advanceTimersByTimeAsync(120_000)
    await done

    expect(apiCalls()).toHaveLength(10)
    expect(Math.min(...gaps())).toBeGreaterThanOrEqual(1100)
  })

  it('keeps spacing even when a request fails', async () => {
    const ol = await loadOpenLibrary()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        calls.push({ url: String(input), at: Date.now() })
        throw new Error('offline')
      })
    )

    const done = Promise.all([
      ol.searchBooks('one'),
      ol.searchBooks('two'),
      ol.searchBooks('three')
    ])
    await vi.advanceTimersByTimeAsync(30_000)
    await done

    expect(calls).toHaveLength(3)
    expect(Math.min(...gaps())).toBeGreaterThanOrEqual(1100)
  })

  it('does not throttle cover downloads, which the covers API exempts', async () => {
    const ol = await loadOpenLibrary()

    const done = Promise.all([ol.downloadCover(1), ol.downloadCover(2), ol.downloadCover(3)])
    await vi.advanceTimersByTimeAsync(100)
    await done

    // Only cover access by ids other than CoverID and OLID is rate-limited,
    // and this fetches strictly by cover id.
    expect(calls).toHaveLength(3)
    expect(calls.every((call) => call.url.startsWith('https://covers.openlibrary.org'))).toBe(true)
    expect(Math.max(...gaps())).toBeLessThan(1100)
  })
})

describe('harvest request budget', () => {
  let db: Database

  beforeEach(() => {
    db = createDatabase(':memory:')
  })

  it('caps a refresh at the documented number of requests', async () => {
    vi.resetModules()
    const { harvestCandidates } = await import('../src/main/services/harvest')

    // Far more material than the caps allow, so the caps decide the count.
    for (let i = 0; i < 10; i++) {
      const book = books.createBook(db, {
        title: `Book ${i}`,
        author: `Author ${i}`,
        status: 'read',
        rating: 5
      })
      saveBookMetadata(db, book.id, {
        subjects: Array.from({ length: 12 }, (_, s) => `subject-${s}`),
        description: 'x'
      })
    }

    const done = harvestCandidates(db)
    await vi.advanceTimersByTimeAsync(300_000)
    await done

    // MAX_SUBJECTS (6) + MAX_AUTHORS (4).
    expect(apiCalls()).toHaveLength(10)
    expect(Math.min(...gaps())).toBeGreaterThanOrEqual(1100)
  })

  it('spends nothing when no book is rated highly enough', async () => {
    vi.resetModules()
    const { harvestCandidates } = await import('../src/main/services/harvest')

    const book = books.createBook(db, {
      title: 'Meh',
      author: 'Someone',
      status: 'read',
      rating: 2
    })
    saveBookMetadata(db, book.id, { subjects: ['boredom'], description: null })

    const done = harvestCandidates(db)
    await vi.advanceTimersByTimeAsync(10_000)
    await done

    expect(calls).toHaveLength(0)
  })
})
