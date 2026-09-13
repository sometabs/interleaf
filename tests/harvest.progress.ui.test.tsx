import type { HarvestResult, Recommendation } from '@shared/api'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import Discover from '../src/renderer/src/components/Discover'
import { installBridge, makeBook, renderApp, type FakeBridge } from './helpers/render'

// Driven by counted steps rather than animation: under reduced motion an
// animation alone is frozen and indistinguishable from a hang.

const REC: Recommendation = {
  olid: 'LHD',
  title: 'The Left Hand of Darkness',
  author: 'Ursula K. Le Guin',
  coverId: null,
  score: 0.5,
  becauseOf: null,
  subjects: ['Science fiction']
}

// A refresh that never settles, so the pending state can be examined.
function show(recommendations: Recommendation[] = [REC]): {
  user: ReturnType<typeof userEvent.setup>
  bridge: FakeBridge
  finish: (result: HarvestResult) => void
} {
  let settle: (result: HarvestResult) => void = () => {}
  const refreshRecommendations = vi.fn(
    () => new Promise<HarvestResult>((resolve) => (settle = resolve))
  )

  const bridge = installBridge(
    { books: [makeBook({ id: 1, rating: 5 })] },
    {
      refreshRecommendations,
      getRecommendations: async () => recommendations,
      getRecommendationTree: async () => []
    }
  )
  renderApp(<Discover />)

  return { user: userEvent.setup(), bridge, finish: (result) => settle(result) }
}

async function startSearch(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByRole('button', { name: 'Search' }))
  await screen.findByRole('region', { name: 'Search progress' })
}

describe('the button that starts a search', () => {
  it('is called Search', async () => {
    show()

    expect(await screen.findByRole('button', { name: 'Search' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Find more' })).toBeNull()
  })
})

describe('waiting for a search', () => {
  it('says nothing until one is running', async () => {
    show()

    await screen.findByRole('button', { name: 'Search' })
    expect(screen.queryByRole('region', { name: 'Search progress' })).toBeNull()
  })

  it('shows the term being looked up', async () => {
    const { user, bridge } = show()
    await startSearch(user)

    bridge.emitHarvestProgress({ done: 1, total: 4, label: 'Books about anarchism' })

    expect(await screen.findByText('Books about anarchism')).toBeTruthy()
  })

  it('counts the steps', async () => {
    const { user, bridge } = show()
    await startSearch(user)

    bridge.emitHarvestProgress({ done: 1, total: 4, label: 'Books about anarchism' })

    expect(await screen.findByText('1 of 4')).toBeTruthy()
  })

  it('fills the bar to the share of the work done', async () => {
    const { user, bridge } = show()
    await startSearch(user)

    bridge.emitHarvestProgress({ done: 3, total: 4, label: 'More by Ursula K. Le Guin' })

    await waitFor(() => {
      const bar = screen.getByRole('progressbar')
      expect((bar.firstElementChild as HTMLElement).style.width).toBe('75%')
    })
  })

  it('says something before the first step arrives', async () => {
    const { user } = show()
    await startSearch(user)

    // The first request is in flight by the time the panel appears.
    expect(await screen.findByText('Asking Open Library…')).toBeTruthy()
  })

  it('goes away when the search ends', async () => {
    const { user, bridge, finish } = show()
    await startSearch(user)
    bridge.emitHarvestProgress({ done: 4, total: 4, label: 'Sorting what came back' })

    finish({ harvested: 12, offline: false })

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Search progress' })).toBeNull()
    )
  })

  // A second search must not open on the first one's finished bar.
  it('starts the next search from empty', async () => {
    const { user, bridge, finish } = show()
    await startSearch(user)
    bridge.emitHarvestProgress({ done: 4, total: 4, label: 'Sorting what came back' })
    finish({ harvested: 12, offline: false })
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Search progress' })).toBeNull()
    )

    await startSearch(user)

    expect(await screen.findByText('Asking Open Library…')).toBeTruthy()
    expect(screen.queryByText('4 of 4')).toBeNull()
  })

  it('replaces the invitation to search rather than sitting under it', async () => {
    const { user } = show([])
    await user.click(await screen.findByRole('button', { name: 'Search' }))

    await screen.findByRole('region', { name: 'Search progress' })
    expect(screen.queryByText(/Press “Search”/)).toBeNull()
  })
})
