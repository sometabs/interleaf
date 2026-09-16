import type { Recommendation, RecommendationQuery } from '@shared/api'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import App from '../src/renderer/src/App'
import BookDetail from '../src/renderer/src/components/BookDetail'
import { useBook } from '../src/renderer/src/lib/queries'
import { installBridge, makeBook, renderApp, type FakeBridge } from './helpers/render'

// Read from the library list as the real route does, so the whole
// click-mutate-invalidate-refetch round trip is exercised.
function BookRoute({ id }: { id: number }): ReactNode {
  const book = useBook(id)
  return book ? <BookDetail key={id} book={book} /> : null
}

function statusButton(label: string): HTMLElement {
  return screen.getByRole('button', { name: label, pressed: undefined }) as HTMLElement
}

function activeStatus(): string | null {
  const pressed = screen
    .getAllByRole('button')
    .find((button) => button.getAttribute('aria-pressed') === 'true')
  return pressed?.textContent?.trim() ?? null
}

describe('book status control', () => {
  let bridge: FakeBridge

  function setup(): void {
    bridge = installBridge({ books: [makeBook()] })
    renderApp(<BookRoute id={1} />, { kind: 'book', id: 1 })
  }

  it('marks the current status on first render', async () => {
    setup()
    await waitFor(() => expect(activeStatus()).toBe('Want to read'))
  })

  it('moves the highlight after clicking a new status', async () => {
    const user = userEvent.setup()
    setup()
    await waitFor(() => expect(activeStatus()).toBe('Want to read'))

    await user.click(statusButton('Reading'))

    await waitFor(() => expect(activeStatus()).toBe('Reading'))
    expect(bridge.books[0].status).toBe('reading')
  })

  // A guessed date is indistinguishable from a checked one.
  it('stamps no start date when moving to Reading', async () => {
    const user = userEvent.setup()
    setup()
    await waitFor(() => expect(activeStatus()).toBe('Want to read'))

    await user.click(statusButton('Reading'))

    await waitFor(() => expect(bridge.books[0].status).toBe('reading'))
    expect(bridge.books[0].startedAt).toBeNull()
  })

  it('handles several status changes in a row', async () => {
    const user = userEvent.setup()
    setup()
    await waitFor(() => expect(activeStatus()).toBe('Want to read'))

    await user.click(statusButton('Reading'))
    await waitFor(() => expect(activeStatus()).toBe('Reading'))
    await user.click(statusButton('Read'))

    await waitFor(() => expect(activeStatus()).toBe('Read'))
    expect(bridge.books[0].finishedAt).toBeNull()
    expect(bridge.books[0].startedAt).toBeNull()
  })

  it('leaves a date the reader typed exactly as it is', async () => {
    const user = userEvent.setup()
    bridge = installBridge({ books: [makeBook({ status: 'want', startedAt: 111 })] })
    renderApp(<BookRoute id={1} />, { kind: 'book', id: 1 })
    await waitFor(() => expect(activeStatus()).toBe('Want to read'))

    await user.click(statusButton('Reading'))

    await waitFor(() => expect(bridge.books[0].status).toBe('reading'))
    expect(bridge.books[0].startedAt).toBe(111)
  })

  it('does not expose separate priority membership controls', async () => {
    setup()
    await screen.findByRole('group', { name: 'Reading status' })
    expect(screen.queryByRole('button', { name: /priority/ })).toBeNull()
  })
})

// DOM node identity is what catches a rebuild: a rebuilt editor is a different
// element, and has lost the cursor and undo history.
describe('editor stability', () => {
  it('survives a refetch triggered by a status change', async () => {
    const user = userEvent.setup()
    installBridge({ books: [makeBook()] })
    renderApp(<BookRoute id={1} />, { kind: 'book', id: 1 })

    const before = await screen.findByTestId('editor')

    await user.click(statusButton('Reading'))
    await waitFor(() => expect(activeStatus()).toBe('Reading'))

    expect(screen.getByTestId('editor')).toBe(before)
  })

  it('survives a rating change', async () => {
    const user = userEvent.setup()
    installBridge({ books: [makeBook()] })
    renderApp(<BookRoute id={1} />, { kind: 'book', id: 1 })

    const before = await screen.findByTestId('editor')

    await user.click(screen.getByRole('button', { name: '4 stars' }))
    await waitFor(() => expect(screen.getByRole('radiogroup')).toHaveProperty('ariaLabel'))

    expect(screen.getByTestId('editor')).toBe(before)
  })
})

describe('finding books like this one', () => {
  it('opens Discover asking about this book', async () => {
    const user = userEvent.setup()
    const getRecommendations = vi.fn<(query?: RecommendationQuery) => Promise<Recommendation[]>>(
      async () => []
    )
    installBridge(
      { books: [makeBook({ id: 1, title: 'Ubik' })] },
      { getRecommendations, getRecommendationTree: async () => [] }
    )
    renderApp(<App />, { kind: 'book', id: 1 })

    await user.click(await screen.findByRole('button', { name: 'Find books like this' }))

    expect(await screen.findByText(/Books like/)).toBeTruthy()
    await waitFor(() =>
      expect(getRecommendations.mock.calls.at(-1)?.[0]).toMatchObject({ likeBookId: 1 })
    )
  })
})
