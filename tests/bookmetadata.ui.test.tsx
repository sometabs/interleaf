import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import BookDetail from '../src/renderer/src/components/BookDetail'
import GenrePicker from '../src/renderer/src/components/GenrePicker'
import { useBook } from '../src/renderer/src/lib/queries'
import { installBridge, makeBook, renderApp, type FakeBridge } from './helpers/render'

function BookRoute({ id }: { id: number }): ReactNode {
  const book = useBook(id)
  return book ? <BookDetail key={id} book={book} /> : null
}

describe('the year and the page count', () => {
  let bridge: FakeBridge

  function setup(overrides = {}): void {
    bridge = installBridge({
      books: [makeBook({ id: 1, publishedYear: null, pageCount: null, ...overrides })],
      notes: []
    })
    renderApp(<BookRoute id={1} />, { kind: 'book', id: 1 })
  }

  it('offers a way in when a book has neither', async () => {
    const user = userEvent.setup()
    setup()

    await user.click(await screen.findByRole('button', { name: 'Year' }))
    await user.type(await screen.findByLabelText('Published year'), '2017{Enter}')

    await waitFor(() => expect(bridge.books[0].publishedYear).toBe(2017))
  })

  it('stores a page count', async () => {
    const user = userEvent.setup()
    setup()

    await user.click(await screen.findByRole('button', { name: 'Pages' }))
    await user.type(await screen.findByLabelText('Page count'), '208{Enter}')

    await waitFor(() => expect(bridge.books[0].pageCount).toBe(208))
  })

  it('shows the unit without storing it', async () => {
    setup({ pageCount: 208 })

    expect(await screen.findByRole('button', { name: '208 pages' })).toBeDefined()
    expect(bridge.books[0].pageCount).toBe(208)
  })

  it('clears the value when the field is emptied', async () => {
    const user = userEvent.setup()
    setup({ publishedYear: 2017 })

    await user.click(await screen.findByRole('button', { name: '2017' }))
    await user.clear(await screen.findByLabelText('Published year'))
    await user.tab()

    await waitFor(() => expect(bridge.books[0].publishedYear).toBeNull())
  })

  // Storing NaN would put the book on a shelf that cannot be sorted.
  it('refuses text that is not a number', async () => {
    const user = userEvent.setup()
    const updateBook = vi.fn(async () => null)
    installBridge({ books: [makeBook({ id: 1, publishedYear: 2017 })], notes: [] }, { updateBook })
    renderApp(<BookRoute id={1} />, { kind: 'book', id: 1 })

    await user.click(await screen.findByRole('button', { name: '2017' }))
    const field = await screen.findByLabelText('Published year')
    await user.clear(field)
    await user.type(field, '19th century{Enter}')

    await waitFor(() => expect(screen.getByRole('button', { name: '2017' })).toBeDefined())
    expect(updateBook).not.toHaveBeenCalled()
  })

  it('refuses a negative page count', async () => {
    const user = userEvent.setup()
    const updateBook = vi.fn(async () => null)
    installBridge({ books: [makeBook({ id: 1, pageCount: 208 })], notes: [] }, { updateBook })
    renderApp(<BookRoute id={1} />, { kind: 'book', id: 1 })

    await user.click(await screen.findByRole('button', { name: '208 pages' }))
    const field = await screen.findByLabelText('Page count')
    await user.clear(field)
    await user.type(field, '-40{Enter}')

    await waitFor(() => expect(screen.getByRole('button', { name: '208 pages' })).toBeDefined())
    expect(updateBook).not.toHaveBeenCalled()
  })

  it('abandons the edit on Escape', async () => {
    const user = userEvent.setup()
    setup({ publishedYear: 2017 })

    await user.click(await screen.findByRole('button', { name: '2017' }))
    const field = await screen.findByLabelText('Published year')
    await user.clear(field)
    await user.type(field, '1999{Escape}')

    await waitFor(() => expect(screen.getByRole('button', { name: '2017' })).toBeDefined())
    expect(bridge.books[0].publishedYear).toBe(2017)
  })
})

describe('choosing the genres', () => {
  let bridge: FakeBridge

  function setup(overrides = {}, subjects: string[] | null = null): void {
    bridge = installBridge(
      { books: [makeBook({ id: 1, genres: null, ...overrides })], notes: [] },
      subjects === null
        ? {}
        : { getBookMetadata: async () => ({ subjects, description: null, fetchedAt: 0 }) }
    )
    renderApp(<BookRoute id={1} />, { kind: 'book', id: 1 })
  }

  function panel(): HTMLElement {
    return screen.getByRole('button', { name: 'Science Fiction' }).closest('div')!.parentElement!
  }

  it('offers a way in when Open Library has said nothing', async () => {
    const user = userEvent.setup()
    setup()

    await user.click(await screen.findByRole('button', { name: 'Edit genres' }))
    await user.click(await screen.findByRole('button', { name: 'Fantasy' }))

    await waitFor(() => expect(bridge.books[0].genres).toEqual(['Fantasy']))
  })

  it('adds a second genre rather than replacing the first', async () => {
    const user = userEvent.setup()
    setup({ genres: ['Fantasy'] })

    await user.click(await screen.findByRole('button', { name: 'Edit genres' }))
    await user.click(within(panel()).getByRole('button', { name: 'Horror' }))

    await waitFor(() => expect(bridge.books[0].genres).toEqual(['Fantasy', 'Horror']))
  })

  it('removes a genre that is chosen again', async () => {
    const user = userEvent.setup()
    setup({ genres: ['Fantasy', 'Horror'] })

    await user.click(await screen.findByRole('button', { name: 'Edit genres' }))
    await user.click(within(panel()).getByRole('button', { name: 'Fantasy' }))

    await waitFor(() => expect(bridge.books[0].genres).toEqual(['Horror']))
  })

  it('marks the chosen ones so the panel shows what is on', async () => {
    const user = userEvent.setup()
    setup({ genres: ['Fantasy'] })

    await user.click(await screen.findByRole('button', { name: 'Edit genres' }))

    expect(within(panel()).getByRole('button', { name: 'Fantasy' }).ariaPressed).toBe('true')
    expect(within(panel()).getByRole('button', { name: 'Horror' }).ariaPressed).toBe('false')
  })

  it('shows the group alongside, derived rather than asked for', async () => {
    setup({ genres: ['Psychology'] })

    expect(await screen.findByText('Non-fiction')).toBeDefined()
  })

  it('says when the genres shown are only a guess', async () => {
    setup({ genres: null }, ['Science fiction'])

    expect(await screen.findByText('From Open Library')).toBeDefined()
  })
})

// Both inputs at once: through the page they arrive at different times, so a
// page-level test can pass merely by looking before the guess turns up.
describe('which genres win', () => {
  const inferred = { group: 'Fiction' as const, genres: ['Science Fiction'] }

  it('shows the reader’s choice instead of the inference, not beside it', () => {
    renderApp(<GenrePicker chosen={['Psychology']} inferred={inferred} onCommit={() => {}} />)

    expect(screen.getByText('Psychology')).toBeDefined()
    expect(screen.getByText('Non-fiction')).toBeDefined()
    expect(screen.queryByText('Science Fiction')).toBeNull()
    expect(screen.queryByText('Fiction')).toBeNull()
  })

  it('shows the inference while nothing has been chosen', () => {
    renderApp(<GenrePicker chosen={null} inferred={inferred} onCommit={() => {}} />)

    expect(screen.getByText('Science Fiction')).toBeDefined()
    expect(screen.getByText('From Open Library')).toBeDefined()
  })

  it('stops calling it a guess once the reader has chosen', () => {
    renderApp(<GenrePicker chosen={['Fantasy']} inferred={inferred} onCommit={() => {}} />)

    expect(screen.getByText('Fantasy')).toBeDefined()
    expect(screen.queryByText('From Open Library')).toBeNull()
  })

  it('shows nothing but the way in when there is neither', () => {
    renderApp(<GenrePicker chosen={null} inferred={null} onCommit={() => {}} />)

    expect(screen.getByRole('button', { name: 'Edit genres' }).textContent).toBe('Add genre')
    expect(screen.queryByText('From Open Library')).toBeNull()
  })

  // A cleared choice is "no genre" and must not fall back to the guess.
  it('shows nothing when the choice is empty, guess or no guess', () => {
    renderApp(<GenrePicker chosen={[]} inferred={inferred} onCommit={() => {}} />)

    expect(screen.queryByText('Science Fiction')).toBeNull()
    expect(screen.queryByText('Fiction')).toBeNull()
  })
})
