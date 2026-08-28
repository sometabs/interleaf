import type { Recommendation, RecommendationQuery } from '@shared/api'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import Discover from '../src/renderer/src/components/Discover'
import { MIN_SHOWN, shownFor } from '../src/renderer/src/lib/shown'
import { installBridge, makeBook, renderApp } from './helpers/render'

function rec(partial: Partial<Recommendation> & { olid: string; title: string }): Recommendation {
  return {
    author: 'Stanisław Lem',
    coverId: null,
    score: 0.5,
    becauseOf: null,
    group: 'Fiction',
    genres: ['Science Fiction'],
    ...partial
  }
}

const ALL = [rec({ olid: 'LHD', title: 'The Left Hand of Darkness' })]
const SCOPED = [rec({ olid: 'HMV', title: "His Master's Voice" })]

type Spy = ReturnType<typeof vi.fn>

function show(): { user: ReturnType<typeof userEvent.setup>; getRecommendations: Spy } {
  const getRecommendations = vi.fn(async (query?: RecommendationQuery) =>
    query?.scope === 'same-authors' ? SCOPED : ALL
  )
  installBridge(
    { books: [makeBook({ id: 1, author: 'Stanisław Lem', rating: 5 })] },
    { getRecommendations, getRecommendationTree: async () => [] }
  )
  renderApp(<Discover />)
  return { user: userEvent.setup(), getRecommendations }
}

// A title appears twice per card: on the cover and as the heading.
async function card(title: string): Promise<HTMLElement> {
  return (await screen.findAllByText(title))[0]
}

function lastQuery(spy: Spy): RecommendationQuery {
  return spy.mock.calls[spy.mock.calls.length - 1][0] as RecommendationQuery
}

describe('what the screen asks for', () => {
  it('sends the scope and the count, and nothing else', async () => {
    const { getRecommendations } = show()

    expect(await card('The Left Hand of Darkness')).toBeTruthy()
    expect(lastQuery(getRecommendations)).toEqual({ limit: MIN_SHOWN, scope: 'all' })
  })

  // The limit widens the MMR pool too, so it has to reach the recommender
  // rather than trim the answer here.
  it('asks for more once the shelf is big enough to support it', async () => {
    const shelf = Array.from({ length: 20 }, (_, i) =>
      makeBook({ id: i + 1, title: `Book ${i + 1}`, author: 'Stanisław Lem', rating: 5 })
    )
    const getRecommendations = vi.fn(async () => ALL)
    installBridge({ books: shelf }, { getRecommendations, getRecommendationTree: async () => [] })
    renderApp(<Discover />)

    await waitFor(() => expect(lastQuery(getRecommendations).limit).toBe(shownFor(20)))
    expect(shownFor(20)).toBeGreaterThan(MIN_SHOWN)
  })
})

describe('narrowing by author', () => {
  it('scopes to authors already read', async () => {
    const { user, getRecommendations } = show()

    await user.click(await screen.findByRole('radio', { name: 'My authors' }))

    await waitFor(() => expect(lastQuery(getRecommendations).scope).toBe('same-authors'))
    expect(await card("His Master's Voice")).toBeTruthy()
    expect(screen.queryAllByText('The Left Hand of Darkness')).toHaveLength(0)
  })

  it('is on the screen rather than behind a panel', async () => {
    show()

    expect(await screen.findByRole('radio', { name: 'All authors' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Filters/ })).toBeNull()
  })
})

describe('remembering the choice', () => {
  it('is still scoped after the app is closed and reopened', async () => {
    const { user } = show()
    await user.click(await screen.findByRole('radio', { name: 'My authors' }))
    await card("His Master's Voice")

    const { getRecommendations } = show()

    await waitFor(() =>
      expect(lastQuery(getRecommendations)).toEqual({ limit: MIN_SHOWN, scope: 'same-authors' })
    )
  })

  // The key used to hold `{ scope, include, exclude }`.
  it('still understands the shape the old filter panel wrote', async () => {
    window.localStorage.setItem(
      'interleaf.discover.filters',
      JSON.stringify({ scope: 'same-authors', include: ['Mystery'], exclude: ['Horror'] })
    )
    const { getRecommendations } = show()

    await waitFor(() => expect(lastQuery(getRecommendations).scope).toBe('same-authors'))
  })

  it('ignores the genres an old filter left behind', async () => {
    window.localStorage.setItem(
      'interleaf.discover.filters',
      JSON.stringify({ scope: 'all', include: ['Mystery'], exclude: ['Horror'] })
    )
    const { getRecommendations } = show()

    expect(await card('The Left Hand of Darkness')).toBeTruthy()
    expect(lastQuery(getRecommendations)).toEqual({ limit: MIN_SHOWN, scope: 'all' })
  })

  // `'preferences'` was written by a mode that no longer exists.
  it('falls back when the stored scope belonged to a mode that is gone', async () => {
    window.localStorage.setItem('interleaf.discover.filters', JSON.stringify('preferences'))
    const { getRecommendations } = show()

    expect(await card('The Left Hand of Darkness')).toBeTruthy()
    expect(lastQuery(getRecommendations).scope).toBe('all')
  })

  // Local Storage moves with the userData directory, so the pre-rename key
  // is still present on the first launch after it.
  it('reads a scope stored under the name the app had before', async () => {
    window.localStorage.setItem('bookhook.discover.filters', JSON.stringify('same-authors'))
    const { getRecommendations } = show()

    await waitFor(() => expect(lastQuery(getRecommendations).scope).toBe('same-authors'))
  })

  it('prefers the current key over the one the old name wrote', async () => {
    window.localStorage.setItem('bookhook.discover.filters', JSON.stringify('same-authors'))
    window.localStorage.setItem('interleaf.discover.filters', JSON.stringify('all'))
    const { getRecommendations } = show()

    expect(await card('The Left Hand of Darkness')).toBeTruthy()
    expect(lastQuery(getRecommendations).scope).toBe('all')
  })

  it('survives a corrupt stored value rather than failing to render', async () => {
    window.localStorage.setItem('interleaf.discover.filters', '{not json')
    const { getRecommendations } = show()

    expect(await card('The Left Hand of Darkness')).toBeTruthy()
    expect(lastQuery(getRecommendations).scope).toBe('all')
  })
})

describe('when there is nothing to scope by', () => {
  it('says the shelf has no authors recorded, rather than blaming the harvest', async () => {
    installBridge(
      { books: [makeBook({ id: 1, author: null, rating: 5 })] },
      { getRecommendations: async () => [], getRecommendationTree: async () => [] }
    )
    renderApp(<Discover />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('radio', { name: 'My authors' }))

    expect(await screen.findByText(/No authors on your shelf yet/)).toBeTruthy()
    expect(screen.queryByText(/Nothing more by those authors yet/)).toBeNull()
  })

  it('blames the harvest when the authors are known but unmatched', async () => {
    installBridge(
      { books: [makeBook({ id: 1, author: 'Stanisław Lem', rating: 5 })] },
      { getRecommendations: async () => [], getRecommendationTree: async () => [] }
    )
    renderApp(<Discover />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('radio', { name: 'My authors' }))

    expect(await screen.findByText(/Nothing more by those authors yet/)).toBeTruthy()
  })
})
