import type { Database } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDatabase } from '../src/main/db/database'
import * as books from '../src/main/repos/books'
import { isTopicSubject } from '../src/main/services/harvest'
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
  const book = books.createBook(db, { title: 'A book', author: 'Someone', rating: 5 })
  saveBookMetadata(db, book.id, { subjects, description: null })

  const harvest = await load()
  const done = harvest.harvestCandidates(db, ['eng'])
  await vi.advanceTimersByTimeAsync(120_000)
  await done

  return queries.filter((q) => q.startsWith('subject:')).map((q) => q.replace(/^subject:"|"$/g, ''))
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
  it('spends no request on a facet', async () => {
    const asked = await harvestWith([
      'award:hugo_award=1970',
      'award:hugo_award=novel',
      'Hugo Award Winner',
      'human nature',
      'gender'
    ])

    expect(asked).toEqual(['human nature', 'gender'])
  })

  // Filing must be dropped before the twelve-subject window, not after.
  it('reaches past a wall of filing to the topics behind it', async () => {
    const wall = Array.from({ length: 12 }, (_, i) => `award:tag=${i}`)
    const asked = await harvestWith([...wall, 'space travel', 'ice age'])

    expect(asked).toEqual(['space travel', 'ice age'])
  })

  it('does not ask the same question twice in different words', async () => {
    const asked = await harvestWith([
      'science-fiction',
      'hard science-fiction',
      'Survival',
      'Survival skills',
      'Murder'
    ])

    expect(asked).toEqual(['science-fiction', 'survival', 'murder'])
  })

  it('still asks for six subjects when it has six to ask about', async () => {
    const asked = await harvestWith([
      'human nature',
      'gender',
      'space travel',
      'ice age',
      'Murder',
      'Dystopia',
      'Adventure'
    ])

    expect(asked).toHaveLength(6)
  })
})

describe('how much each request brings back', () => {
  // The request costs a second; the rows it returns are free.
  it('asks for sixty works per subject rather than twenty-four', async () => {
    await harvestWith(['human nature'])

    const subjectCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.includes('q=subject'))

    expect(subjectCalls).toHaveLength(1)
    expect(new URL(subjectCalls[0]).searchParams.get('limit')).toBe('60')
  })

  it('asks for forty works per author', async () => {
    await harvestWith(['human nature'])

    const authorCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.includes('author='))

    expect(authorCalls).toHaveLength(1)
    expect(new URL(authorCalls[0]).searchParams.get('limit')).toBe('40')
  })

  it('makes no more requests than before', async () => {
    await harvestWith(['human nature', 'gender', 'space travel', 'ice age', 'Murder', 'Dystopia'])

    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(7)
    expect(scorableCandidates(db)).toHaveLength(0)
  })
})
