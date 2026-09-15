import type { Database } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDatabase } from '../src/main/db/database'
import * as books from '../src/main/repos/books'
import { isTopicSubject, planDiscoveryQueries } from '../src/main/services/harvest'
import { saveBookMetadata, scorableCandidates, upsertCandidates } from '../src/main/repos/metadata'

let db: Database
let queries: string[] = []

function installFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const q = new URL(String(input)).searchParams.get('q')
      if (q) queries.push(q)
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ docs: [] }),
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

async function harvestWith(subjects: string[]): Promise<string[]> {
  const book = books.createBook(db, {
    title: 'A book',
    author: 'Someone',
    status: 'read',
    rating: 5
  })
  saveBookMetadata(db, book.id, { subjects, description: null })

  const harvest = await load()
  const done = harvest.harvestCandidates(db)
  await vi.advanceTimersByTimeAsync(120_000)
  await done
  return queries
}

beforeEach(() => {
  queries = []
  db = createDatabase(':memory:')
  vi.useFakeTimers()
  installFetch()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('using Open Library subjects directly', () => {
  it('accepts catalogue, facet, and non-English subjects instead of classifying them', () => {
    expect(isTopicSubject('Accessible book')).toBe(true)
    expect(isTopicSubject('award:hugo_award=1970')).toBe(true)
    expect(isTopicSubject('Ciencia-ficción')).toBe(true)
    expect(isTopicSubject('Knowledge, theory of')).toBe(true)
  })

  it('rejects only an empty or non-searchable value', () => {
    expect(isTopicSubject('')).toBe(false)
    expect(isTopicSubject('  = / :  ')).toBe(false)
  })

  it('queries the returned label rather than translating it to a local genre', () => {
    const plan = planDiscoveryQueries([
      { title: 'A', author: null, subjects: ['Fiction, psychological', 'Accessible book'] }
    ])

    expect(plan.subjects.map((entry) => entry.query)).toEqual([
      'subject:"Fiction, psychological"',
      'subject:"Accessible book"'
    ])
  })

  it('uses every subject when choosing the six strongest unique queries', () => {
    const subjects = Array.from({ length: 14 }, (_, index) => `Subject ${index + 1}`)
    const plan = planDiscoveryQueries([{ title: 'A', author: null, subjects }])

    expect(plan.subjects).toHaveLength(6)
    expect(plan.subjects.map((entry) => entry.query)).toEqual(
      subjects.slice(0, 6).map((subject) => `subject:"${subject}"`)
    )
  })

  it('ranks a subject shared by more liked books first', () => {
    const plan = planDiscoveryQueries([
      { title: 'A', author: null, subjects: ['Anarchism', 'Utopias'] },
      { title: 'B', author: null, subjects: ['Philosophy', 'Anarchism'] }
    ])

    expect(plan.subjects[0].query).toBe('subject:"Anarchism"')
  })

  it('preserves non-ASCII labels in the query', () => {
    const plan = planDiscoveryQueries([
      { title: 'A', author: null, subjects: ['Identité de genre'] }
    ])

    expect(plan.subjects[0].query).toBe('subject:"Identité de genre"')
  })
})

describe('what a search actually asks for', () => {
  it('does not generate searches from a want-to-read book', async () => {
    const book = books.createBook(db, {
      title: 'Maybe someday',
      author: 'Someone',
      status: 'want',
      rating: 5
    })
    saveBookMetadata(db, book.id, { subjects: ['science fiction'], description: null })

    const harvest = await load()
    const done = harvest.harvestCandidates(db)
    await vi.advanceTimersByTimeAsync(30_000)
    await done

    expect(queries).toEqual([])
  })

  it('targets only the selected book when searching online for similar books', async () => {
    const philosophy = books.createBook(db, {
      title: 'Being and Nothingness',
      author: 'Jean-Paul Sartre',
      status: 'read',
      rating: 5
    })
    saveBookMetadata(db, philosophy.id, { subjects: ['philosophy'], description: null })
    const scienceFiction = books.createBook(db, {
      title: 'Solaris',
      author: 'Stanisław Lem',
      status: 'want'
    })
    saveBookMetadata(db, scienceFiction.id, {
      subjects: ['science fiction'],
      description: null
    })

    const harvest = await load()
    const done = harvest.harvestCandidates(db, undefined, scienceFiction.id)
    await vi.advanceTimersByTimeAsync(30_000)
    await done

    expect(queries).toEqual([
      'subject:"science fiction"',
      'author:"Stanisław Lem" AND subject:"science fiction"'
    ])
    expect(queries.some((query) => query.includes('philosophy'))).toBe(false)
  })

  it('adds a targeted online search without replacing the general cache', async () => {
    const book = books.createBook(db, { title: 'Solaris', author: 'Stanisław Lem' })
    saveBookMetadata(db, book.id, { subjects: ['science fiction'], description: null })
    upsertCandidates(db, [
      {
        olid: 'OL1W',
        editionOlid: 'OL1M',
        isbn: null,
        title: 'A cached book',
        author: 'Someone',
        subjects: ['philosophy'],
        description: null,
        coverId: null,
        pageCount: null,
        publishedYear: null,
        source: 'subject:philosophy',
        languages: ['eng']
      }
    ])

    const harvest = await load()
    const done = harvest.harvestCandidates(db, undefined, book.id)
    await vi.advanceTimersByTimeAsync(30_000)
    await done

    expect(scorableCandidates(db).map((candidate) => candidate.title)).toContain('A cached book')
  })

  it('combines an author with the strongest direct subject', async () => {
    const asked = await harvestWith(['science fiction', 'politics'])

    expect(asked).toContain('author:"Someone" AND subject:"science fiction"')
  })

  it('asks for fifty works per subject query and thirty per author query', async () => {
    await harvestWith(['human nature', 'gender'])
    const urls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map(([input]) =>
      String(input)
    )
    const subjectCalls = urls.filter((url) => {
      const q = new URL(url).searchParams.get('q') ?? ''
      return q.startsWith('subject:')
    })
    const authorCalls = urls.filter((url) => {
      const q = new URL(url).searchParams.get('q') ?? ''
      return q.startsWith('author:')
    })

    expect(subjectCalls.length).toBeGreaterThan(0)
    for (const url of subjectCalls) expect(new URL(url).searchParams.get('limit')).toBe('50')
    expect(authorCalls).toHaveLength(1)
    expect(new URL(authorCalls[0]).searchParams.get('limit')).toBe('30')
  })

  it('never exceeds the eight-request discovery budget', async () => {
    await harvestWith(['one', 'two', 'three', 'four', 'five', 'six', 'seven'])

    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(8)
    expect(scorableCandidates(db)).toHaveLength(0)
  })
})
