import type { Recommendation, RecommendationQuery } from '@shared/api'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import Discover from '../src/renderer/src/components/Discover'
import { shownFor } from '../src/renderer/src/lib/shown'
import { installBridge, makeBook, renderApp } from './helpers/render'

// These ask `shownFor` rather than restating the number, so the two cannot
// drift apart.

function pool(size: number): Recommendation[] {
  return Array.from({ length: size }, (_, i) => ({
    olid: `OL${i}W`,
    title: `Candidate ${i}`,
    author: `Author ${i}`,
    coverId: null,
    score: 1 - i / 1000,
    becauseOf: null,
    subjects: ['Science fiction']
  }))
}

type Spy = ReturnType<typeof vi.fn>

function shelf(size: number): ReturnType<typeof makeBook>[] {
  return Array.from({ length: size }, (_, i) =>
    makeBook({ id: i + 1, title: `Book ${i + 1}`, author: `Author ${i + 1}`, rating: 5 })
  )
}

function show(
  available: number,
  books = 1
): {
  user: ReturnType<typeof userEvent.setup>
  getRecommendations: Spy
  getRecommendationTree: Spy
} {
  const all = pool(available)
  // What the main process does with `limit`: a stub ignoring it would hide a
  // limit that never left the page.
  const getRecommendations = vi.fn(async (query?: RecommendationQuery) =>
    all.slice(0, query?.limit ?? 12)
  )
  const getRecommendationTree = vi.fn(async (query?: RecommendationQuery) =>
    all.slice(0, query?.limit ?? 12).map((rec) => ({
      ...rec,
      similarityToParent: null,
      depth: 0,
      children: []
    }))
  )

  installBridge({ books: shelf(books) }, { getRecommendations, getRecommendationTree })
  renderApp(<Discover />)
  return { user: userEvent.setup(), getRecommendations, getRecommendationTree }
}

function cards(): HTMLElement[] {
  return screen.getAllByRole('article')
}

function lastQuery(spy: Spy): RecommendationQuery {
  return spy.mock.calls[spy.mock.calls.length - 1][0] as RecommendationQuery
}

describe('how many suggestions are shown', () => {
  it('shows as many as the shelf supports', async () => {
    show(100)

    await waitFor(() => expect(cards()).toHaveLength(shownFor(1)))
  })

  it('shows more for a bigger shelf', async () => {
    show(100, 20)

    await waitFor(() => expect(cards()).toHaveLength(shownFor(20)))
    expect(shownFor(20)).toBeGreaterThan(shownFor(1))
  })

  // The limit widens the MMR pool as well as the list, so it has to reach the
  // recommender rather than trim a longer list here.
  it('asks the recommender for exactly that many', async () => {
    const { getRecommendations } = show(100, 20)

    await waitFor(() => expect(cards()).toHaveLength(shownFor(20)))
    expect(lastQuery(getRecommendations).limit).toBe(shownFor(20))
  })

  it('offers no way to page further into the pool', async () => {
    show(100)

    await waitFor(() => expect(cards()).toHaveLength(shownFor(1)))
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
  })

  it('shows what there is when the pool is smaller than the limit', async () => {
    show(9)

    await waitFor(() => expect(cards()).toHaveLength(9))
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
  })

  it('holds the tree to the same number', async () => {
    const { user, getRecommendationTree } = show(100, 20)
    await waitFor(() => expect(cards()).toHaveLength(shownFor(20)))

    await user.click(await screen.findByRole('button', { name: 'tree' }))

    await waitFor(() => expect(lastQuery(getRecommendationTree).limit).toBe(shownFor(20)))
    expect(cards()).toHaveLength(shownFor(20))
  })
})
