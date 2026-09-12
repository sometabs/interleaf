import type { Database } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HarvestProgress } from '../src/shared/api'
import { createDatabase } from '../src/main/db/database'
import * as books from '../src/main/repos/books'
import { saveBookMetadata } from '../src/main/repos/metadata'

let db: Database

// Reports and requests interleaved: the counter alone cannot show whether a
// step was announced before or after the second it cost.
let events: string[] = []

function doc(key: string, title: string): unknown {
  return {
    key,
    title,
    author_name: ['Stanisław Lem'],
    cover_i: 2,
    subject: ['science fiction'],
    language: ['eng']
  }
}

function installFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = String(input)
      events.push(url.includes('q=subject') ? 'fetch:subject' : 'fetch:author')

      const body = url.includes('q=subject')
        ? { docs: [doc('/works/OL1W', 'Subject hit')] }
        : { docs: [doc('/works/OL2W', 'Author hit')] }

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
async function load(): Promise<typeof import('../src/main/services/harvest')> {
  vi.resetModules()
  return import('../src/main/services/harvest')
}

function likedBook(): void {
  const book = books.createBook(db, {
    title: 'Solaris',
    author: 'Stanisław Lem',
    status: 'read',
    rating: 5
  })
  saveBookMetadata(db, book.id, { subjects: ['science fiction'], description: null })
}

async function run(languages?: readonly string[]): Promise<HarvestProgress[]> {
  const harvest = await load()
  const seen: HarvestProgress[] = []

  const done = harvest.harvestCandidates(db, languages ?? ['eng'], (progress) => {
    seen.push(progress)
    events.push(`report:${progress.label}`)
  })
  await vi.advanceTimersByTimeAsync(60_000)
  await done

  return seen
}

beforeEach(() => {
  events = []
  db = createDatabase(':memory:')
  vi.useFakeTimers()
  installFetch()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('reporting a harvest as it runs', () => {
  it('names the subject it is looking up', async () => {
    likedBook()

    const seen = await run()

    expect(seen.map((p) => p.label)).toContain('More books about science fiction')
  })

  it('never spends a step on an Open Library facet', async () => {
    const book = books.createBook(db, {
      title: 'A book',
      author: 'Someone',
      status: 'read',
      rating: 5
    })
    saveBookMetadata(db, book.id, {
      subjects: ['award:hugo_award=1970', 'human nature'],
      description: null
    })

    const seen = await run()
    const labels = seen.map((p) => p.label)

    expect(labels).toContain('More books about human nature')
    expect(labels.join(' ')).not.toContain('award:hugo_award')
    expect(seen[seen.length - 1].total).toBe(2)
  })

  it('names the author it is looking up', async () => {
    likedBook()

    const seen = await run()

    expect(seen.map((p) => p.label)).toContain('More by Stanisław Lem about science fiction')
  })

  it('announces a step before spending the second it costs', async () => {
    likedBook()

    await run()

    // The counter increments only once the request is back, so it reads
    // `done: 0` on either side of the fetch.
    expect(events).toEqual([
      'report:More books about science fiction',
      'fetch:subject',
      'report:More by Stanisław Lem about science fiction',
      'fetch:author',
      'report:Sorting what came back'
    ])
  })

  it('finishes on a full bar', async () => {
    likedBook()

    const seen = await run()
    const last = seen[seen.length - 1]

    expect(last.done).toBe(last.total)
    expect(last.total).toBeGreaterThan(0)
  })

  // The first estimate is the worst case, so it may shrink but never grow:
  // growing makes the bar retreat mid-search.
  it('never moves backwards', async () => {
    likedBook()

    const seen = await run()

    expect(seen.length).toBeGreaterThan(1)
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i].done).toBeGreaterThanOrEqual(seen[i - 1].done)
      expect(seen[i].total).toBeLessThanOrEqual(seen[i - 1].total)
      expect(seen[i].done / seen[i].total).toBeGreaterThanOrEqual(
        seen[i - 1].done / seen[i - 1].total
      )
    }
  })

  it('counts one step per term it actually looked up', async () => {
    likedBook()

    const seen = await run()

    // Uncorrected, this would end at the cap of ten and jump the last 80%.
    expect(seen[seen.length - 1].total).toBe(2)
  })

  it('closes the report when there is nothing to look for', async () => {
    const seen = await run()
    const last = seen[seen.length - 1]

    expect(last.label).toBe('Nothing to look for yet')
    expect(last.done).toBe(last.total)
  })

  it('harvests exactly the same without anyone listening', async () => {
    likedBook()
    const harvest = await load()

    const done = harvest.harvestCandidates(db, ['eng'])
    await vi.advanceTimersByTimeAsync(60_000)

    await expect(done).resolves.toMatchObject({ offline: false })
  })
})
