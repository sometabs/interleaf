import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import BookDetail from '../src/renderer/src/components/BookDetail'
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

describe('Open Library subjects', () => {
  it('shows them unchanged without offering manual genre controls', async () => {
    installBridge(
      { books: [makeBook({ id: 1, genres: ['Fantasy'] })], notes: [] },
      {
        getBookMetadata: async () => ({
          subjects: ['Fiction, psychological', 'Accessible book'],
          description: null,
          fetchedAt: 0
        })
      }
    )
    renderApp(<BookRoute id={1} />, { kind: 'book', id: 1 })

    expect(await screen.findByText('Open Library subjects (2)')).toBeDefined()
    expect(screen.getByText('Fiction, psychological')).toBeDefined()
    expect(screen.getByText('Accessible book')).toBeDefined()
    expect(screen.queryByRole('button', { name: /genres?/i })).toBeNull()
    expect(screen.queryByText('Fantasy')).toBeNull()
  })
})
