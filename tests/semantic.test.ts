import { describe, expect, it, vi } from 'vitest'

import type { RecommendationNode } from '../src/shared/api'
import type { CandidateInput, ProfileBook } from '../src/main/services/recommender'
import {
  semanticRecommend,
  semanticRecommendTree,
  type SemanticEmbedder
} from '../src/main/services/semantic'

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

function candidate(overrides: Partial<CandidateInput> = {}): CandidateInput {
  return {
    olid: 'OL1W',
    title: 'Candidate',
    author: 'Writer',
    subjects: ['philosophy'],
    description: null,
    coverId: null,
    languages: ['eng'],
    ...overrides
  }
}

const conceptualEmbedder: SemanticEmbedder = async (texts) =>
  new Map(
    texts.map((text) => {
      const lower = text.toLowerCase()
      if (lower.includes('philosophy') || lower.includes('meaningless universe')) {
        return [text, [1, 0, 0]]
      }
      if (lower.includes('science fiction') || lower.includes('spaceship')) {
        return [text, [0, 1, 0]]
      }
      if (lower.includes('hybrid interest')) {
        return [text, [Math.SQRT1_2, Math.SQRT1_2, 0]]
      }
      return [text, [0, 0, 1]]
    })
  )

const noProgress = (): void => {}

describe('semantic recommendations', () => {
  it('can match related meaning without sharing the same words', async () => {
    const found = await semanticRecommend(
      [libraryBook()],
      [
        candidate({
          olid: 'SEMANTIC',
          title: 'The Absurd',
          subjects: [],
          description: 'Seeking purpose in a meaningless universe.'
        }),
        candidate({
          olid: 'OTHER',
          title: 'Starship',
          subjects: [],
          description: 'A spaceship crosses the galaxy.'
        })
      ],
      { limit: 2 },
      'unused',
      noProgress,
      conceptualEmbedder
    )

    expect(found.map((book) => book.olid)).toEqual(['SEMANTIC'])
  })

  it('uses one selected book instead of the whole shelf when requested', async () => {
    const found = await semanticRecommend(
      [
        libraryBook({ bookId: 1, subjects: ['philosophy'] }),
        libraryBook({ bookId: 2, subjects: ['science fiction'] })
      ],
      [
        candidate({ olid: 'PHIL', subjects: ['philosophy'] }),
        candidate({ olid: 'SCIFI', subjects: ['science fiction'] })
      ],
      { likeBookId: 2, limit: 2 },
      'unused',
      noProgress,
      conceptualEmbedder
    )

    expect(found.map((book) => book.olid)).toEqual(['SCIFI'])
  })

  it('keeps separate library interests instead of preferring their midpoint', async () => {
    const found = await semanticRecommend(
      [
        libraryBook({ bookId: 1, subjects: ['philosophy'] }),
        libraryBook({ bookId: 2, subjects: ['science fiction'] })
      ],
      [
        candidate({ olid: 'MIDPOINT', subjects: ['hybrid interest'] }),
        candidate({ olid: 'PHIL', subjects: ['philosophy'] }),
        candidate({ olid: 'SCIFI', subjects: ['science fiction'] })
      ],
      { limit: 1 },
      'unused',
      noProgress,
      conceptualEmbedder
    )

    expect(found[0].olid).toBe('PHIL')
  })

  it('prevents one library book from explaining most whole-library results', async () => {
    const found = await semanticRecommend(
      [
        libraryBook({ bookId: 1, title: 'Philosophy', subjects: ['philosophy'] }),
        libraryBook({ bookId: 2, title: 'Science fiction', subjects: ['science fiction'] })
      ],
      [
        ...Array.from({ length: 3 }, (_, index) =>
          candidate({
            olid: `PHIL-${index}`,
            author: `Philosopher ${index}`,
            subjects: ['philosophy']
          })
        ),
        ...Array.from({ length: 3 }, (_, index) =>
          candidate({
            olid: `SCIFI-${index}`,
            author: `Writer ${index}`,
            subjects: ['science fiction']
          })
        )
      ],
      { limit: 4 },
      'unused',
      noProgress,
      conceptualEmbedder
    )

    const counts = new Map<number, number>()
    for (const book of found) {
      const source = book.becauseOf!.bookId
      counts.set(source, (counts.get(source) ?? 0) + 1)
    }
    expect([...counts.values()].sort()).toEqual([2, 2])
  })

  it('penalises a candidate that resembles a disliked book more than a liked one', async () => {
    const found = await semanticRecommend(
      [
        libraryBook({ bookId: 1, subjects: ['philosophy'], rating: 5 }),
        libraryBook({ bookId: 2, subjects: ['science fiction'], rating: 1 })
      ],
      [
        candidate({ olid: 'PHIL', subjects: ['philosophy'] }),
        candidate({ olid: 'SCIFI', subjects: ['science fiction'] })
      ],
      { limit: 2 },
      'unused',
      noProgress,
      conceptualEmbedder
    )

    expect(found.map((book) => book.olid)).toEqual(['PHIL'])
  })

  it('does not load the model when there is no useful metadata', async () => {
    const embedder = vi.fn(conceptualEmbedder)
    const found = await semanticRecommend(
      [libraryBook({ subjects: [], description: null })],
      [candidate()],
      {},
      'unused',
      noProgress,
      embedder
    )

    expect(found).toEqual([])
    expect(embedder).not.toHaveBeenCalled()
  })

  it('builds tree branches from semantic similarity', async () => {
    const roots = await semanticRecommendTree(
      [
        libraryBook({ bookId: 1, title: 'Philosophy', subjects: ['philosophy'] }),
        libraryBook({ bookId: 2, title: 'Science fiction', subjects: ['science fiction'] })
      ],
      [
        candidate({ olid: 'PHIL-1', author: 'A', subjects: ['philosophy'] }),
        candidate({ olid: 'PHIL-2', author: 'B', description: 'A meaningless universe.' }),
        candidate({ olid: 'SCIFI-1', author: 'C', subjects: ['science fiction'] }),
        candidate({ olid: 'SCIFI-2', author: 'D', description: 'A spaceship crosses the galaxy.' })
      ],
      { limit: 4 },
      'unused',
      noProgress,
      conceptualEmbedder
    )
    const flatten = (nodes: RecommendationNode[]): RecommendationNode[] =>
      nodes.flatMap((node) => [node, ...flatten(node.children)])
    const all = flatten(roots)

    expect(new Set(all.map((book) => book.olid))).toEqual(
      new Set(['PHIL-1', 'PHIL-2', 'SCIFI-1', 'SCIFI-2'])
    )
    expect(roots).toHaveLength(2)
    expect(all.filter((book) => book.depth === 1)).toHaveLength(2)
    expect(
      all.filter((book) => book.depth === 1).every((book) => book.similarityToParent === 1)
    ).toBe(true)
  })
})
