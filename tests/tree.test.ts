import type { RecommendationNode } from '../src/shared/api'
import { describe, expect, it } from 'vitest'

import {
  recommendTree,
  type CandidateInput,
  type ProfileBook
} from '../src/main/services/recommender'

// Depth is distance: no child is ever nearer to the profile than its parent.
// Asserted as an invariant, since the arrangement depends on the corpus.

function libraryBook(overrides: Partial<ProfileBook> = {}): ProfileBook {
  return {
    bookId: 1,
    title: 'The Dispossessed',
    author: 'Le Guin',
    rating: 5,
    subjects: ['utopias', 'anarchism', 'science fiction'],
    description: 'A physicist crosses between two worlds.',
    finishedAt: null,
    ...overrides
  }
}

function candidate(olid: string, subjects: string[]): CandidateInput {
  return {
    olid,
    title: `Book ${olid}`,
    author: 'Someone',
    subjects,
    description: null,
    coverId: 1,
    languages: ['eng']
  }
}

function flatten(roots: RecommendationNode[]): RecommendationNode[] {
  return roots.flatMap((node) => [node, ...flatten(node.children)])
}

function eachParentChild(
  roots: RecommendationNode[]
): { parent: RecommendationNode; child: RecommendationNode }[] {
  return flatten(roots).flatMap((parent) => parent.children.map((child) => ({ parent, child })))
}

const library = [libraryBook()]

const candidates = [
  candidate('A', ['utopias', 'anarchism', 'science fiction']),
  candidate('B', ['utopias', 'anarchism']),
  candidate('C', ['science fiction', 'space']),
  candidate('D', ['space', 'exploration']),
  candidate('E', ['anarchism', 'politics']),
  candidate('F', ['gardening', 'herbs'])
]

describe('recommendTree', () => {
  it('returns nothing without a library or candidates', () => {
    expect(recommendTree([], candidates)).toEqual([])
    expect(recommendTree(library, [])).toEqual([])
  })

  it('roots the tree at the book closest to the profile', () => {
    const roots = recommendTree(library, candidates)
    const all = flatten(roots)
    const best = all.reduce((a, b) => (b.score > a.score ? b : a))

    expect(roots[0].olid).toBe(best.olid)
    expect(roots[0].depth).toBe(0)
  })

  it('never places a child nearer to the profile than its parent', () => {
    const roots = recommendTree(library, candidates)

    for (const { parent, child } of eachParentChild(roots)) {
      expect(child.score).toBeLessThanOrEqual(parent.score)
    }
  })

  it('numbers depth as one more than the parent', () => {
    const roots = recommendTree(library, candidates)

    for (const { parent, child } of eachParentChild(roots)) {
      expect(child.depth).toBe(parent.depth + 1)
    }
  })

  it('records how much each child resembles its parent', () => {
    const roots = recommendTree(library, candidates)

    for (const { child } of eachParentChild(roots)) {
      expect(child.similarityToParent).toBeGreaterThan(0)
      expect(child.similarityToParent).toBeLessThanOrEqual(1)
    }
    for (const root of roots) expect(root.similarityToParent).toBeNull()
  })

  it('includes every scored candidate exactly once', () => {
    const roots = recommendTree(library, candidates)
    const olids = flatten(roots).map((node) => node.olid)

    expect(new Set(olids).size).toBe(olids.length)
    expect(olids).not.toContain('F')
    expect(olids).toContain('A')
  })

  it('starts a separate root rather than inventing kinship', () => {
    const split = [
      libraryBook({ bookId: 1, subjects: ['anarchism', 'beekeeping'], description: null })
    ]
    const roots = recommendTree(split, [
      candidate('A', ['anarchism']),
      candidate('B', ['beekeeping'])
    ])

    expect(roots).toHaveLength(2)
    for (const root of roots) {
      expect(root.depth).toBe(0)
      expect(root.similarityToParent).toBeNull()
    }
  })

  it('honours the limit across the whole tree, not per level', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      candidate(`x${i}`, ['utopias', 'anarchism', `variant-${i % 5}`])
    )

    expect(flatten(recommendTree(library, many, { limit: 5 }))).toHaveLength(5)
  })

  it('keeps the same explanation the list view shows', () => {
    const roots = recommendTree(library, candidates)

    expect(roots[0].becauseOf).toEqual({ bookId: 1, title: 'The Dispossessed' })
    expect(roots[0].subjects.length).toBeGreaterThan(0)
  })
})
