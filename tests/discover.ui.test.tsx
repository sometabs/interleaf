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
    editionOlid: null,
    coverId: null,
    isbn: null,
    pageCount: null,
    publishedYear: null,
    description: null,
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

function advancedSwitch(checked: boolean): HTMLElement {
  return screen.getByRole('switch', { name: 'Advanced recommendations', checked })
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

describe('advanced recommendations', () => {
  it('keeps keyword results before first-use consent and exposes no ranking selector', async () => {
    const getHybridRecommendations = vi.fn(async () => [])
    installBridge(
      { books: [makeBook()] },
      {
        getRecommendations: async () => ALL,
        getHybridRecommendations
      }
    )
    renderApp(<Discover />)
    await card(ALL[0].title)
    expect(screen.queryByRole('group', { name: 'Ranking' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Standard' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Advanced' })).toBeNull()
    expect(screen.getByText('Cached Open Library books')).toBeTruthy()
    expect(advancedSwitch(false)).toBeTruthy()
    expect(getHybridRecommendations).not.toHaveBeenCalled()
  })

  it('opens and closes the help without changing the recommendation mode', async () => {
    const getHybridRecommendations = vi.fn(async () => [])
    installBridge(
      { books: [makeBook()] },
      { getRecommendations: async () => ALL, getHybridRecommendations }
    )
    renderApp(<Discover />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'About advanced recommendations' }))
    expect(
      screen.getByRole('dialog', { name: 'About advanced recommendations' }).textContent
    ).toContain('Combines keyword matching with AI')
    expect(screen.getByText(/uses more RAM/i)).toBeTruthy()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(advancedSwitch(false)).toBeTruthy()
    expect(getHybridRecommendations).not.toHaveBeenCalled()
  })

  it('explains memory use and requests download consent before using advanced ranking', async () => {
    const match = rec({ olid: 'HYB', title: 'A Hybrid Match', scoreKind: 'fusion' })
    const getHybridRecommendations = vi.fn(async () => [match])
    const refreshRecommendations = vi.fn()
    installBridge(
      { books: [makeBook()] },
      {
        getRecommendations: async () => ALL,
        getHybridRecommendations,
        refreshRecommendations
      }
    )
    renderApp(
      <>
        <Discover />
        <ConfirmDialog />
      </>
    )
    const user = userEvent.setup()
    await card(ALL[0].title)
    await user.click(advancedSwitch(false))
    expect(getHybridRecommendations).not.toHaveBeenCalled()
    expect(screen.getByText(/uses more RAM/i)).toBeTruthy()
    expect(screen.getByText(/35 MB/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Turn on' }))
    await card(match.title)
    expect(getHybridRecommendations).toHaveBeenCalledWith({ limit: MIN_SHOWN })
    expect(window.localStorage.getItem('interleaf.advancedDownloadAcknowledged')).toBe('true')
    expect(refreshRecommendations).not.toHaveBeenCalled()
    expect(advancedSwitch(true)).toBeTruthy()
  })

  it('remembers when advanced recommendations are off and turns them back on with prior consent', async () => {
    window.localStorage.setItem('interleaf.advancedDownloadAcknowledged', 'true')
    const match = rec({ olid: 'HYB', title: 'A Hybrid Match', scoreKind: 'fusion' })
    const getHybridRecommendations = vi.fn(async () => [match])
    installBridge(
      { books: [makeBook()] },
      { getRecommendations: async () => ALL, getHybridRecommendations }
    )
    const user = userEvent.setup()
    const ui = (
      <>
        <Discover />
        <ConfirmDialog />
      </>
    )
    const first = renderApp(ui)
    await card(match.title)
    advancedSwitch(true).focus()
    await user.keyboard('[Space]')
    await card(ALL[0].title)
    expect(advancedSwitch(false)).toBeTruthy()
    expect(window.localStorage.getItem('interleaf.advancedDownloadAcknowledged')).toBe('true')

    first.unmount()
    renderApp(ui)
    await card(ALL[0].title)
    expect(getHybridRecommendations).toHaveBeenCalledOnce()
    await user.click(advancedSwitch(false))
    await card(match.title)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(advancedSwitch(true)).toBeTruthy()
  })

  it('keeps keyword results if the download is declined', async () => {
    const getHybridRecommendations = vi.fn(async () => [])
    installBridge(
      { books: [makeBook()] },
      {
        getRecommendations: async () => ALL,
        getHybridRecommendations
      }
    )
    renderApp(
      <>
        <Discover />
        <ConfirmDialog />
      </>
    )
    const user = userEvent.setup()
    await user.click(advancedSwitch(false))
    await user.click(screen.getByRole('button', { name: 'Not now' }))
    await card(ALL[0].title)
    expect(getHybridRecommendations).not.toHaveBeenCalled()
    expect(window.localStorage.getItem('interleaf.advancedDownloadAcknowledged')).toBeNull()
  })

  it.each(['standard', 'semantic', 'hybrid'])(
    'ignores the old %s mode choice once the model was approved',
    async (previous) => {
      window.localStorage.setItem('interleaf.advancedDownloadAcknowledged', 'true')
      window.localStorage.setItem('interleaf.recommendationRanking', JSON.stringify(previous))
      const getHybridRecommendations = vi.fn(async () => ALL)
      const getRecommendations = vi.fn(async () => ALL)
      installBridge({ books: [makeBook()] }, { getHybridRecommendations, getRecommendations })
      renderApp(<Discover />)
      await card(ALL[0].title)
      expect(getHybridRecommendations).toHaveBeenCalledOnce()
      expect(getRecommendations).not.toHaveBeenCalled()
      expect(screen.queryByRole('group', { name: 'Ranking' })).toBeNull()
      expect(advancedSwitch(true)).toBeTruthy()
    }
  )

  it('does not treat an old mode choice as download consent', async () => {
    window.localStorage.setItem('interleaf.recommendationRanking', '"semantic"')
    const getHybridRecommendations = vi.fn(async () => [])
    installBridge(
      { books: [makeBook()] },
      {
        getRecommendations: async () => ALL,
        getHybridRecommendations
      }
    )
    renderApp(<Discover />)
    await card(ALL[0].title)
    expect(getHybridRecommendations).not.toHaveBeenCalled()
  })

  it('automatically falls back on error and can retry Hybrid', async () => {
    window.localStorage.setItem('interleaf.advancedDownloadAcknowledged', 'true')
    const getHybridRecommendations = vi
      .fn()
      .mockRejectedValueOnce(new Error('The model could not load'))
      .mockResolvedValue([rec({ olid: 'HYB', title: 'A Hybrid Match', scoreKind: 'fusion' })])
    const getRecommendations = vi.fn(async () => ALL)
    installBridge(
      { books: [makeBook()] },
      {
        getRecommendations,
        getHybridRecommendations
      }
    )
    renderApp(<Discover />)
    await screen.findByText('Advanced recommendations are unavailable. Showing keyword results.')
    await card(ALL[0].title)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await card('A Hybrid Match')
    expect(getRecommendations).toHaveBeenCalledOnce()
    expect(
      screen.queryByText('Advanced recommendations are unavailable. Showing keyword results.')
    ).toBeNull()
  })

  it('uses the keyword tree automatically if the model fails', async () => {
    window.localStorage.setItem('interleaf.advancedDownloadAcknowledged', 'true')
    window.localStorage.setItem('interleaf.recommendationLayout', '"tree"')
    installBridge(
      { books: [makeBook()] },
      {
        getRecommendationTree: async () => [
          { ...ALL[0], similarityToParent: null, depth: 0, children: [] }
        ],
        getHybridRecommendationTree: async () => {
          throw new Error('Model unavailable')
        }
      }
    )
    renderApp(<Discover />)
    await screen.findByText('Advanced recommendations are unavailable. Showing keyword results.')
    await card(ALL[0].title)
  })

  it('remembers the layout without writing the legacy ranking mode', async () => {
    window.localStorage.setItem('interleaf.advancedDownloadAcknowledged', 'true')
    const getHybridRecommendationTree = vi.fn(async () => [])
    installBridge(
      { books: [makeBook()] },
      {
        getHybridRecommendations: async () => [],
        getHybridRecommendationTree
      }
    )
    const first = renderApp(<Discover />)
    await userEvent.click(await screen.findByRole('button', { name: 'tree' }))
    await waitFor(() =>
      expect(getHybridRecommendationTree).toHaveBeenCalledWith({ limit: MIN_SHOWN })
    )
    first.unmount()
    renderApp(<Discover />)
    expect(screen.getByRole('button', { name: 'tree' }).getAttribute('aria-pressed')).toBe('true')
    expect(window.localStorage.getItem('interleaf.recommendationRanking')).toBeNull()
  })

  it('labels a fused rank without inventing a similarity percentage', async () => {
    window.localStorage.setItem('interleaf.advancedDownloadAcknowledged', 'true')
    window.localStorage.setItem('interleaf.recommendationLayout', '"tree"')
    const hybrid = rec({
      olid: 'TREE',
      title: 'Hybrid Tree Match',
      score: 0.0327,
      scoreKind: 'fusion'
    })
    installBridge(
      { books: [makeBook()] },
      {
        getHybridRecommendationTree: async () => [
          { ...hybrid, similarityToParent: null, depth: 0, children: [] }
        ]
      }
    )
    renderApp(<Discover />)
    expect(await screen.findByText('Advanced match')).toBeTruthy()
    expect(screen.queryByText('3% match')).toBeNull()
  })

  it('uses the selected book without starting an online search', async () => {
    window.localStorage.setItem('interleaf.advancedDownloadAcknowledged', 'true')
    const getHybridRecommendations = vi.fn(async () => ALL)
    const refreshRecommendations = vi.fn()
    installBridge(
      { books: [makeBook({ id: 7 })] },
      {
        getHybridRecommendations,
        refreshRecommendations
      }
    )
    renderApp(<Discover />, { kind: 'discover', likeBookId: 7 })
    await card(ALL[0].title)
    expect(getHybridRecommendations).toHaveBeenLastCalledWith({ limit: MIN_SHOWN, likeBookId: 7 })
    expect(refreshRecommendations).not.toHaveBeenCalled()
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
