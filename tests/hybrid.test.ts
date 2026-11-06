import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Recommendation, RecommendationNode } from '../src/shared/api'
import {
  hybridRecommend,
  hybridRecommendTree,
  reciprocalRankFusion
} from '../src/main/services/hybrid'
import type { CandidateInput, ProfileBook } from '../src/main/services/recommender'
import type { SemanticEmbedder } from '../src/main/services/semantic'

function rec(olid: string, score = 1): Recommendation {
  return {
    olid,
    title: olid,
    author: olid,
    score,
    editionOlid: null,
    coverId: null,
    isbn: null,
    pageCount: null,
    publishedYear: null,
    description: null,
    becauseOf: null,
    subjects: []
  }
}

describe('reciprocal rank fusion', () => {
  it('reinforces agreement and retains matches unique to either ranker', () => {
    const result = reciprocalRankFusion([
      [rec('keyword'), rec('both')],
      [rec('meaning'), rec('both')]
    ])
    expect(result[0].olid).toBe('both')
    expect(new Set(result.map(({ olid }) => olid))).toEqual(new Set(['keyword', 'meaning', 'both']))
    expect(result[0].score).toBeCloseTo(2 / 62)
    expect(result.every(({ scoreKind }) => scoreKind === 'fusion')).toBe(true)
  })

  it('uses positions, not the incompatible underlying scores', () => {
    expect(reciprocalRankFusion([[rec('A', 0.001), rec('B', 1000)]])[0].olid).toBe('A')
  })

  it('does not count duplicate proposals from one method as extra votes or ranks', () => {
    const result = reciprocalRankFusion([[rec('A'), rec('A'), rec('B')], [rec('B')]])
    expect(result).toHaveLength(2)
    expect(result[0].olid).toBe('B')
    expect(result.find(({ olid }) => olid === 'A')!.score).toBeCloseTo(1 / 61)
    expect(result[0].score).toBeCloseTo(1 / 62 + 1 / 61)
  })

  it('has a deterministic tie-breaker', () => {
    expect(reciprocalRankFusion([[rec('B')], [rec('A')]]).map(({ olid }) => olid)).toEqual([
      'A',
      'B'
    ])
  })

  it('keeps the explanation from the method that ranked the work higher', () => {
    const keyword = { ...rec('BOTH'), becauseOf: { bookId: 1, title: 'Keyword source' } }
    const meaning = { ...rec('BOTH'), becauseOf: { bookId: 2, title: 'Meaning source' } }
    const fused = reciprocalRankFusion([[keyword], [rec('OTHER'), meaning]])
    expect(fused.find(({ olid }) => olid === 'BOTH')!.becauseOf).toEqual(keyword.becauseOf)
  })

  it('handles an empty ranker or empty pool', () => {
    expect(reciprocalRankFusion([[], []])).toEqual([])
    expect(reciprocalRankFusion([[], [rec('A')]]).map(({ olid }) => olid)).toEqual(['A'])
  })
})

function libraryBook(overrides: Partial<ProfileBook> = {}): ProfileBook {
  return {
    bookId: 1,
    title: 'Library book',
    author: 'Reader',
    status: 'read',
    rating: 5,
    subjects: ['philosophy'],
    description: null,
    finishedAt: null,
    ...overrides
  }
}

function candidate(olid: string, overrides: Partial<CandidateInput> = {}): CandidateInput {
  return {
    olid,
    title: olid,
    author: olid,
    subjects: [],
    description: null,
    coverId: null,
    languages: ['eng'],
    ...overrides
  }
}

const embedder: SemanticEmbedder = async (texts) =>
  new Map(
    texts.map((text) => {
      if (text.includes('keyword-only')) return [text, [0, 1, 0]]
      if (text.includes('both-rankers')) return [text, [0.9, 0, Math.sqrt(0.19)]]
      if (text.includes('astronomy')) return [text, [0, 1, 0]]
      return [text, [1, 0, 0]]
    })
  )
const candidates = [
  candidate('KEYWORD', { subjects: ['philosophy'], description: 'keyword-only' }),
  candidate('MEANING', { description: 'Understanding existence.' }),
  candidate('BOTH', { subjects: ['philosophy'], description: 'both-rankers' })
]
const noProgress = (): void => {}

afterEach(() => vi.unstubAllGlobals())

describe('hybrid recommendations', () => {
  it('combines raw rankings before diversity, retaining matches from both', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('No network in local ranking')
      })
    )
    const found = await hybridRecommend(
      [libraryBook()],
      candidates,
      { likeBookId: 1, limit: 3 },
      'unused',
      noProgress,
      embedder
    )
    expect(found[0].olid).toBe('BOTH')
    expect(new Set(found.map(({ olid }) => olid))).toEqual(new Set(['KEYWORD', 'MEANING', 'BOTH']))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('embeds one shared pool, rather than running a second fetch', async () => {
    const embed = vi.fn(embedder)
    await hybridRecommend([libraryBook()], candidates, { limit: 3 }, 'unused', noProgress, embed)
    expect(embed).toHaveBeenCalledOnce()
    const texts = embed.mock.calls[0][0]
    expect(texts).toHaveLength(4)
    expect(texts.some((text) => text.includes('keyword-only'))).toBe(true)
    expect(texts.some((text) => text.includes('Understanding existence.'))).toBe(true)
  })

  it('preserves the selected candidate metadata when combining the rankings', async () => {
    const original = candidate('COMPLETE', {
      editionOlid: 'OL123M',
      isbn: '9780000000009',
      coverId: 123,
      pageCount: 240,
      publishedYear: 2024,
      subjects: ['philosophy'],
      description: 'A synthetic catalogue description.'
    })
    const found = await hybridRecommend(
      [libraryBook()],
      [original],
      {},
      'unused',
      noProgress,
      embedder
    )
    expect(found[0]).toMatchObject({
      olid: original.olid,
      editionOlid: original.editionOlid,
      isbn: original.isbn,
      coverId: original.coverId,
      pageCount: original.pageCount,
      publishedYear: original.publishedYear,
      subjects: original.subjects,
      description: original.description
    })
  })

  it('uses the selected book instead of mixing the whole library profile', async () => {
    const embed = vi.fn(embedder)
    await hybridRecommend(
      [libraryBook(), libraryBook({ bookId: 2, subjects: ['astronomy'] })],
      candidates,
      { likeBookId: 1, limit: 3 },
      'unused',
      noProgress,
      embed
    )
    expect(embed.mock.calls[0][0].some((text) => text.includes('astronomy'))).toBe(false)
  })

  it('preserves the same-author scope before either ranker runs', async () => {
    const found = await hybridRecommend(
      [libraryBook()],
      [
        candidate('KNOWN', { author: 'Reader', subjects: ['philosophy'] }),
        candidate('OTHER', { author: 'Someone Else', subjects: ['philosophy'] })
      ],
      { scope: 'same-authors' },
      'unused',
      noProgress,
      embedder
    )
    expect(found.map(({ olid }) => olid)).toEqual(['KNOWN'])
  })

  it('does not load a model for an unqualified whole-library profile', async () => {
    const embed = vi.fn(embedder)
    expect(
      await hybridRecommend(
        [libraryBook({ status: 'want' })],
        candidates,
        {},
        'unused',
        noProgress,
        embed
      )
    ).toEqual([])
    expect(embed).not.toHaveBeenCalled()
  })

  it('does not load a model when there is no useful metadata', async () => {
    const embed = vi.fn(embedder)
    expect(
      await hybridRecommend(
        [libraryBook({ subjects: [] })],
        candidates,
        {},
        'unused',
        noProgress,
        embed
      )
    ).toEqual([])
    expect(embed).not.toHaveBeenCalled()
  })

  it('applies the author cap after fusion, not independently to each list', async () => {
    const pool = Array.from({ length: 4 }, (_, index) =>
      candidate(`SAME-${index}`, { author: 'Same Author', subjects: ['philosophy'] })
    )
    pool.push(candidate('OTHER', { author: 'Other Author', subjects: ['philosophy'] }))
    const found = await hybridRecommend(
      [libraryBook()],
      pool,
      { likeBookId: 1, limit: 3 },
      'unused',
      noProgress,
      embedder
    )
    expect(found.filter(({ author }) => author === 'Same Author')).toHaveLength(2)
    expect(found.some(({ olid }) => olid === 'OTHER')).toBe(true)
  })

  it('does not promote an off-topic book just because its vector is more different', async () => {
    const closeToSource: SemanticEmbedder = async (texts) =>
      new Map(
        texts.map((text) => {
          const similarity = text.includes('tomatoes') ? 0.1 : text.includes('rational') ? 0.99 : 1
          return [text, [similarity, Math.sqrt(1 - similarity ** 2)]]
        })
      )
    const found = await hybridRecommend(
      [libraryBook()],
      [
        candidate('BOTH', { subjects: ['philosophy'] }),
        candidate('RELATED', { description: 'A study of rational thought.' }),
        candidate('OFF-TOPIC', { description: 'How to grow tomatoes.' })
      ],
      { likeBookId: 1, limit: 2 },
      'unused',
      noProgress,
      closeToSource
    )
    expect(found.map(({ olid }) => olid)).toEqual(['BOTH', 'RELATED'])
  })

  it('builds a tree from the same fused selection without treating RRF as similarity', async () => {
    const options = { likeBookId: 1, limit: 3 }
    const list = await hybridRecommend(
      [libraryBook()],
      candidates,
      options,
      'unused',
      noProgress,
      embedder
    )
    const tree = await hybridRecommendTree(
      [libraryBook()],
      candidates,
      options,
      'unused',
      noProgress,
      embedder
    )
    const flatten = (nodes: RecommendationNode[]): RecommendationNode[] =>
      nodes.flatMap((node) => [node, ...flatten(node.children)])
    const all = flatten(tree)
    expect(new Set(all.map(({ olid }) => olid))).toEqual(new Set(list.map(({ olid }) => olid)))
    expect(all.every(({ scoreKind }) => scoreKind === 'fusion')).toBe(true)
    expect(
      all
        .filter((node) => node.depth > 0)
        .every((node) => node.similarityToParent! > 0 && node.similarityToParent! <= 1)
    ).toBe(true)
  })

  it('reports a model failure to the UI so it can show Standard results', async () => {
    const failed = vi.fn(async () => {
      throw new Error('Model unavailable')
    })
    await expect(
      hybridRecommend([libraryBook()], candidates, {}, 'unused', noProgress, failed)
    ).rejects.toThrow('Model unavailable')
  })
})
