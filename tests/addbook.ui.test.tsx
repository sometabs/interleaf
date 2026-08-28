import type { OlBookDto } from '@shared/api'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AddBookDialog from '../src/renderer/src/components/AddBookDialog'
import { installBridge, renderApp } from './helpers/render'

// Open Library allows about one request a second, so the debounce in front of
// the search box is a rate-limit control.

const searchOpenLibrary = vi.fn<(query: string) => Promise<OlBookDto[]>>()

function typist(): ReturnType<typeof userEvent.setup> {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
}

function open(): void {
  installBridge({}, { searchOpenLibrary })
  renderApp(<AddBookDialog open onOpenChange={() => {}} />)
}

// Past the 600ms debounce, plus room for the query to be dispatched.
async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(700)
  })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  searchOpenLibrary.mockReset()
  searchOpenLibrary.mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Open Library search', () => {
  it('sends nothing at all while the keys are still coming', async () => {
    const user = typist()
    open()

    await user.type(screen.getByLabelText('Search for a book'), 'the dispossessed')
    await settle()

    expect(searchOpenLibrary).not.toHaveBeenCalled()
  })

  it('costs nothing to hesitate mid-title', async () => {
    const user = typist()
    open()
    const field = screen.getByLabelText('Search for a book')

    await user.type(field, 'dune')
    await settle()
    await user.type(field, ' mess')
    await settle()
    await user.type(field, 'iah')
    await settle()

    expect(searchOpenLibrary).not.toHaveBeenCalled()
  })

  it('sends exactly one request when Search is pressed', async () => {
    const user = typist()
    open()

    await user.type(screen.getByLabelText('Search for a book'), 'the dispossessed')
    await user.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => expect(searchOpenLibrary).toHaveBeenCalledOnce())
    expect(searchOpenLibrary).toHaveBeenCalledWith('the dispossessed')
  })

  it('submits on Enter, the way a search box is expected to', async () => {
    const user = typist()
    open()

    await user.type(screen.getByLabelText('Search for a book'), 'dune{Enter}')

    await waitFor(() => expect(searchOpenLibrary).toHaveBeenCalledOnce())
    expect(searchOpenLibrary).toHaveBeenCalledWith('dune')
  })

  it('refuses a query too short to mean anything', async () => {
    const user = typist()
    open()

    await user.type(screen.getByLabelText('Search for a book'), 'd{Enter}')

    expect(searchOpenLibrary).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Search' })).toHaveProperty('disabled', true)
  })

  it('costs nothing to search the same thing twice', async () => {
    const user = typist()
    open()
    const field = screen.getByLabelText('Search for a book')

    await user.type(field, 'dune{Enter}')
    await waitFor(() => expect(searchOpenLibrary).toHaveBeenCalledOnce())

    await user.clear(field)
    await user.type(field, 'dune{Enter}')
    await settle()

    expect(searchOpenLibrary).toHaveBeenCalledOnce()
  })

  // "Nothing found" is a claim about the catalogue, which a request that
  // failed is not entitled to make.
  it('says the search failed when it failed, not that the book does not exist', async () => {
    const user = typist()
    open()
    searchOpenLibrary.mockRejectedValue(new Error('Open Library did not answer.'))

    await user.type(screen.getByLabelText('Search for a book'), 'the dispossessed{Enter}')

    expect(await screen.findByText(/Open Library is unreachable/i)).toBeTruthy()
    expect(screen.queryByText(/has nothing for that/i)).toBeNull()
  })

  // The way out of a failed lookup is to add the book now and refresh later,
  // so that button has to be present while the failure is on screen.
  it('points at the way through, and offers it', async () => {
    const user = typist()
    open()
    searchOpenLibrary.mockRejectedValue(new Error('Open Library did not answer.'))

    await user.type(screen.getByLabelText('Search for a book'), 'the dispossessed{Enter}')

    expect(await screen.findByText(/Refresh metadata/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Add .the dispossessed. manually/ })).toBeTruthy()
  })

  it('says the catalogue has nothing when the search really came back empty', async () => {
    const user = typist()
    open()
    searchOpenLibrary.mockResolvedValue([])

    await user.type(screen.getByLabelText('Search for a book'), 'qwertyuiop not a book{Enter}')

    expect(await screen.findByText(/has nothing for that/i)).toBeTruthy()
    expect(screen.queryByText(/Open Library is unreachable/i)).toBeNull()
  })

  it('lets a book be added by hand without ever searching', async () => {
    const user = typist()
    open()

    await user.type(screen.getByLabelText('Search for a book'), 'A Private Notebook')

    expect(
      await screen.findByRole('button', { name: /Add .A Private Notebook. manually/ })
    ).toBeTruthy()
    expect(searchOpenLibrary).not.toHaveBeenCalled()
  })
})
