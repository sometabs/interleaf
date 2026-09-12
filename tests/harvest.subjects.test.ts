import type { Database } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDatabase } from '../src/main/db/database'
import * as books from '../src/main/repos/books'
import { isTopicSubject, planDiscoveryQueries } from '../src/main/services/harvest'
import { saveBookMetadata, scorableCandidates } from '../src/main/repos/metadata'

let db: Database
let queries: string[] = []

function installFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input))
      const q = url.searchParams.get('q')
      const author = url.searchParams.get('author')
      if (q) queries.push(q)
      if (author) queries.push(`author:${author}`)

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
  const done = harvest.harvestCandidates(db, ['eng'])
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

describe('telling a topic from a filing card', () => {
  const topics = [
    'human nature',
    'gender',
    'space travel',
    'Dystopia',
    'post-apocalyptic fiction',
    'Fathers and sons',
    'Home schooling',
    'Science fiction',
    'Fictional characters'
  ]
  for (const subject of topics) {
    it(`keeps "${subject}"`, () => {
      expect(isTopicSubject(subject)).toBe(true)
    })
  }

  const filing = [
    'award:hugo_award=1970',
    'nyt:paperback-nonfiction=2018-06-03',
    'Hugo Award Winner',
    'New York Times bestseller',
    'Open Library Staff Picks',
    'Reading Level-Grade 7',
    'Accessible book',
    'Protected DAISY',
    'In library',
    'OverDrive',
    'Large type books',
    'Fiction',
    'General',
    'Novels',
    'FICTION / Science Fiction / Action & Adventure',
    'BIOGRAPHY & AUTOBIOGRAPHY / Personal Memoirs',
    'Long Now Manual for Civilization',
    'Fiction, science fiction, general',
    'Science fiction, American',
    'Dune (Imaginary place)',
    'Translations into Yiddish',
    'German language',
    'Ciencia-ficción',
    'Identité de genre',
    'ab'
  ]
  for (const subject of filing) {
    it(`refuses "${subject}"`, () => {
      expect(isTopicSubject(subject)).toBe(false)
    })
  }

  // A work is filed under its subjects in every language it was catalogued
  // in, and each spelling costs a request for the same books.
  const otherLanguages = [
    'Ciencia-ficción',
    'Historia',
    'Historia universal',
    'Novela',
    'Geschichte',
    'Literatura',
    'Letteratura',
    'Histoire',
    'Amerikanisches Englisch'
  ]
  for (const subject of otherLanguages) {
    it(`refuses "${subject}", which is a subject it already has in English`, () => {
      expect(isTopicSubject(subject)).toBe(false)
    })
  }

  // Short on purpose: "Roman" leads French and German subjects but also
  // "Roman Britain", and refusing a real subject is the worse error.
  it('does not refuse an English subject that looks foreign', () => {
    expect(isTopicSubject('Roman Britain')).toBe(true)
    expect(isTopicSubject('Romance')).toBe(true)
    expect(isTopicSubject('History')).toBe(true)
  })

  it('does not refuse a topic that merely starts with a refused word', () => {
    expect(isTopicSubject('Fictional characters')).toBe(true)
    expect(isTopicSubject('Literature and society')).toBe(true)
    expect(isTopicSubject('Generation ships')).toBe(true)
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
    saveBookMetadata(db, book.id, { subjects: ['science fiction', 'politics'], description: null })

    const harvest = await load()
    const done = harvest.harvestCandidates(db, ['eng'])
    await vi.advanceTimersByTimeAsync(30_000)
    await done

    expect(queries).toEqual([])
  })

  it('spends no request on a facet', async () => {
    const asked = await harvestWith([
      'award:hugo_award=1970',
      'award:hugo_award=novel',
      'Hugo Award Winner',
      'human nature',
      'gender'
    ])

    expect(asked.join(' ')).toContain('subject_key:nature')
    expect(asked.join(' ')).toContain('subject_key:gender')
    expect(asked.join(' ')).not.toContain('award')
  })

  // Filing must be dropped before the twelve-subject window, not after.
  it('reaches past a wall of filing to the topics behind it', async () => {
    const wall = Array.from({ length: 12 }, (_, i) => `award:tag=${i}`)
    const asked = await harvestWith([...wall, 'space travel', 'ice age'])

    expect(asked.join(' ')).toContain('subject_key:travel')
    expect(asked.join(' ')).toContain('subject_key:ice_age')
    expect(asked.join(' ')).not.toContain('award')
  })

  it('does not ask the same question twice in different words', async () => {
    const asked = await harvestWith([
      'science-fiction',
      'hard science-fiction',
      'Survival',
      'Survival skills',
      'Murder'
    ])

    expect(asked.join(' ')).toContain('subject_key:science_fiction')
    expect(asked.join(' ')).toContain('subject_key:survival')
    expect(asked.join(' ')).toContain('subject_key:murder')
    expect(asked.join(' ')).not.toContain('hard_science_fiction')
    expect(asked.join(' ')).not.toContain('survival_skills')
  })

  it('never reuses a subject across the six genre-balanced searches', async () => {
    const asked = await harvestWith([
      'human nature',
      'gender',
      'space travel',
      'ice age',
      'Murder',
      'Dystopia',
      'Adventure'
    ])

    const subjectQueries = asked.filter((query) => query.startsWith('subject_key:'))
    const subjects = subjectQueries.flatMap((query) => query.match(/subject_key:[a-z0-9_]+/g) ?? [])

    expect(subjectQueries.length).toBeLessThanOrEqual(6)
    expect(new Set(subjects).size).toBe(subjects.length)
  })

  it('gives distinct genres a turn instead of letting history take every slot', () => {
    const plan = planDiscoveryQueries([
      { title: 'Mystery', author: 'A', subjects: ['History', 'Mystery fiction'] },
      { title: 'Memoir', author: 'B', subjects: ['History', 'Biography'] },
      { title: 'Ideas', author: 'C', subjects: ['History', 'Philosophy', 'Ethics'] },
      { title: 'Trees', author: 'D', subjects: ['History', 'Nature', 'Ecology'] },
      { title: 'Space', author: 'E', subjects: ['Science fiction', 'Space travel'] },
      { title: 'Love', author: 'F', subjects: ['Romance', 'Love stories'] }
    ])
    const asked = plan.subjects.map((entry) => entry.query)
    const allSubjects = asked.flatMap((query) => query.match(/subject_key:[a-z0-9_]+/g) ?? [])

    expect(asked).toHaveLength(6)
    expect(asked.filter((query) => query.includes('subject_key:history'))).toHaveLength(1)
    expect(asked.some((query) => query.includes('subject_key:philosophy'))).toBe(true)
    expect(asked.some((query) => query.includes('subject_key:science_fiction'))).toBe(true)
    expect(asked.some((query) => query.includes('subject_key:nature'))).toBe(true)
    expect(new Set(allSubjects).size).toBe(allSubjects.length)
  })

  it('combines an author with a strong subject instead of fetching every work', async () => {
    const asked = await harvestWith(['science fiction', 'politics'])

    expect(asked).toContain('author:"Someone" AND subject_key:science_fiction')
    expect(asked).not.toContain('author:Someone')
  })
})

describe('how much each request brings back', () => {
  // The request costs a second; the rows it returns are free.
  it('asks for fifty works per subject query', async () => {
    await harvestWith(['human nature', 'gender'])

    const subjectCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
      .map(([input]) => String(input))
      .filter((url) => (new URL(url).searchParams.get('q') ?? '').startsWith('subject_key:'))

    expect(subjectCalls.length).toBeGreaterThan(0)
    for (const url of subjectCalls) expect(new URL(url).searchParams.get('limit')).toBe('50')
  })

  it('asks for thirty works per targeted author query', async () => {
    await harvestWith(['human nature'])

    const authorCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
      .map(([input]) => String(input))
      .filter((url) => (new URL(url).searchParams.get('q') ?? '').startsWith('author:'))

    expect(authorCalls).toHaveLength(1)
    expect(new URL(authorCalls[0]).searchParams.get('limit')).toBe('30')
  })

  it('never exceeds the eight-request discovery budget', async () => {
    await harvestWith(['human nature', 'gender', 'space travel', 'ice age', 'Murder', 'Dystopia'])

    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(8)
    expect(scorableCandidates(db)).toHaveLength(0)
  })
})
