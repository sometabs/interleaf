import type { Recommendation, RecommendationQuery } from '@shared/api'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import Discover from '../src/renderer/src/components/Discover'
import ConfirmDialog from '../src/renderer/src/components/ConfirmDialog'
import { MIN_SHOWN, shownFor } from '../src/renderer/src/lib/shown'
import { installBridge, makeBook, renderApp } from './helpers/render'

function rec(partial: Partial<Recommendation> & { olid: string; title: string }): Recommendation {
  return {
    author: 'Stanisław Lem',
    coverId: null,
    score: 0.5,
    becauseOf: null,
    subjects: ['Science fiction'],
    ...partial
  }
}

const ALL = [rec({ olid: 'LHD', title: 'The Left Hand of Darkness' })]

type Spy = ReturnType<typeof vi.fn>

function show(): { getRecommendations: Spy } {
  const getRecommendations = vi.fn(async () => ALL)
  installBridge(
    { books: [makeBook({ id: 1, author: 'Stanisław Lem', rating: 5 })] },
    { getRecommendations, getRecommendationTree: async () => [] }
  )
  renderApp(<Discover />)
  return { getRecommendations }
}

// A title appears twice per card: on the cover and as the heading.
async function card(title: string): Promise<HTMLElement> {
  return (await screen.findAllByText(title))[0]
}

function lastQuery(spy: Spy): RecommendationQuery {
  return spy.mock.calls[spy.mock.calls.length - 1][0] as RecommendationQuery
}

describe('what the screen asks for', () => {
  it('sends the count and nothing else', async () => {
    const { getRecommendations } = show()

    expect(await card('The Left Hand of Darkness')).toBeTruthy()
    expect(lastQuery(getRecommendations)).toEqual({ limit: MIN_SHOWN })
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

describe('author filter removal', () => {
  it('does not offer an author scope', async () => {
    show()
    await card('The Left Hand of Darkness')

    expect(screen.queryByRole('radiogroup', { name: 'Authors' })).toBeNull()
    expect(screen.queryByRole('radio', { name: 'My authors' })).toBeNull()
  })
})

describe('ranking mode', () => {
  it('starts with cached Standard results and switches locally to Semantic', async () => {
    const semanticResult = rec({ olid: 'SEM', title: 'A Contextual Match', score: 0.81 })
    const getSemanticRecommendations = vi.fn(async () => [semanticResult])
    const getSemanticRecommendationTree = vi.fn(async () => [
      { ...semanticResult, similarityToParent: null, depth: 0, children: [] }
    ])
    installBridge(
      { books: [makeBook({ id: 1, status: 'read', rating: 5 })] },
      {
        getRecommendations: async () => ALL,
        getSemanticRecommendations,
        getSemanticRecommendationTree,
        getRecommendationTree: async () => []
      }
    )
    renderApp(
      <>
        <Discover />
        <ConfirmDialog />
      </>
    )
    const user = userEvent.setup()

    expect(await card('The Left Hand of Darkness')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Standard' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
    expect(getSemanticRecommendations).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Advanced' }))
    expect(screen.getByText('Enable Advanced recommendations?')).toBeTruthy()
    expect(getSemanticRecommendations).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Enable Advanced' }))

    expect(await card('A Contextual Match')).toBeTruthy()
    expect(getSemanticRecommendations).toHaveBeenCalledWith({ limit: MIN_SHOWN })
    expect(screen.getByText(/advanced ranking/)).toBeTruthy()
    expect(window.localStorage.getItem('interleaf.advancedDownloadAcknowledged')).toBe('true')

    await user.click(screen.getByRole('button', { name: 'tree' }))
    await waitFor(() =>
      expect(getSemanticRecommendationTree).toHaveBeenCalledWith({ limit: MIN_SHOWN })
    )
  })

  it('remembers Advanced ranking and the tree layout', async () => {
    window.localStorage.setItem('interleaf.advancedDownloadAcknowledged', 'true')
    const getSemanticRecommendations = vi.fn(async () => [])
    const getSemanticRecommendationTree = vi.fn(async () => [])
    installBridge(
      { books: [makeBook({ id: 1, status: 'read', rating: 5 })] },
      {
        getRecommendations: async () => ALL,
        getRecommendationTree: async () => [],
        getSemanticRecommendations,
        getSemanticRecommendationTree
      }
    )
    const first = renderApp(<Discover />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Advanced' }))
    await user.click(screen.getByRole('button', { name: 'tree' }))
    expect(window.localStorage.getItem('interleaf.recommendationRanking')).toBe('"semantic"')
    expect(window.localStorage.getItem('interleaf.recommendationLayout')).toBe('"tree"')
    first.unmount()

    renderApp(<Discover />)
    expect(
      (await screen.findByRole('button', { name: 'Advanced' })).getAttribute('aria-pressed')
    ).toBe('true')
    expect(screen.getByRole('button', { name: 'tree' }).getAttribute('aria-pressed')).toBe('true')
    await waitFor(() =>
      expect(getSemanticRecommendationTree).toHaveBeenCalledWith({ limit: MIN_SHOWN })
    )
  })
})

describe('books like one book', () => {
  const LIKE = [rec({ olid: 'SOL', title: 'Solaris', becauseOf: { bookId: 1, title: 'Ubik' } })]

  function open(): {
    user: ReturnType<typeof userEvent.setup>
    getRecommendations: Spy
    refreshRecommendations: Spy
  } {
    const getRecommendations = vi.fn(async (query?: RecommendationQuery) =>
      query?.likeBookId === undefined ? ALL : LIKE
    )
    const refreshRecommendations = vi.fn(async () => ({ harvested: 3, offline: false }))
    installBridge(
      { books: [makeBook({ id: 1, title: 'Ubik', author: 'Philip K. Dick', rating: 5 })] },
      { getRecommendations, getRecommendationTree: async () => [], refreshRecommendations }
    )
    renderApp(<Discover />, { kind: 'discover', likeBookId: 1 })
    return { user: userEvent.setup(), getRecommendations, refreshRecommendations }
  }

  it('asks about that book alone', async () => {
    const { getRecommendations } = open()

    expect(await card('Solaris')).toBeTruthy()
    expect(lastQuery(getRecommendations)).toEqual({ limit: MIN_SHOWN, likeBookId: 1 })
  })

  it('says which book is being matched', async () => {
    open()
    expect(await screen.findByText(/Books like/)).toBeTruthy()
    expect(await screen.findByText(/cached results/)).toBeTruthy()
  })

  it('offers a separate targeted online search', async () => {
    const { user, refreshRecommendations } = open()
    await card('Solaris')

    expect(refreshRecommendations).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Search online' }))

    await waitFor(() => expect(refreshRecommendations).toHaveBeenCalledWith({ likeBookId: 1 }))
  })

  it('does not restore the removed author scope', async () => {
    open()
    await card('Solaris')
    expect(screen.queryByRole('radiogroup', { name: 'Authors' })).toBeNull()
  })

  it('drops the reason, since the banner already gives it', async () => {
    open()
    await card('Solaris')
    expect(screen.queryByText(/Because you liked/)).toBeNull()
  })

  it('goes back to the whole shelf', async () => {
    const { user, getRecommendations } = open()
    await card('Solaris')

    await user.click(screen.getByRole('button', { name: 'Show my whole shelf' }))

    expect(await card('The Left Hand of Darkness')).toBeTruthy()
    expect(lastQuery(getRecommendations)).toEqual({ limit: MIN_SHOWN })
  })

  it('says so when nothing in the pool is near that book', async () => {
    installBridge(
      { books: [makeBook({ id: 1, title: 'Ubik', rating: 5 })] },
      { getRecommendations: async () => [], getRecommendationTree: async () => [] }
    )
    renderApp(<Discover />, { kind: 'discover', likeBookId: 1 })

    expect(await screen.findByText(/Nothing in the pool resembles Ubik/)).toBeTruthy()
  })
})
