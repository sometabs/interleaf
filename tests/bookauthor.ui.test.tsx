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

describe('editing a book’s author', () => {
  let bridge: FakeBridge

  function setup(overrides = {}): void {
    bridge = installBridge({
      books: [makeBook({ id: 1, title: 'Dune', author: 'Frank Herbert', ...overrides })],
      notes: []
    })
    renderApp(<BookRoute id={1} />, { kind: 'book', id: 1 })
  }

  it('stores a corrected author', async () => {
    const user = userEvent.setup()
    setup()

    await user.click(await screen.findByRole('button', { name: 'Frank Herbert' }))
    const field = await screen.findByLabelText('Author')
    await user.clear(field)
    await user.type(field, 'Frank Patrick Herbert{Enter}')

    await waitFor(() => expect(bridge.books[0].author).toBe('Frank Patrick Herbert'))
    expect(await screen.findByRole('button', { name: 'Frank Patrick Herbert' })).toBeDefined()
  })

  it('offers a way in when the book has no author at all', async () => {
    const user = userEvent.setup()
    setup({ author: null })

    await user.click(await screen.findByRole('button', { name: 'Add author' }))
    await user.type(await screen.findByLabelText('Author'), 'Gary John Bishop{Enter}')

    await waitFor(() => expect(bridge.books[0].author).toBe('Gary John Bishop'))
  })

  it('commits when the field loses focus', async () => {
    const user = userEvent.setup()
    setup()

    await user.click(await screen.findByRole('button', { name: 'Frank Herbert' }))
    const field = await screen.findByLabelText('Author')
    await user.clear(field)
    await user.type(field, 'Ursula K. Le Guin')
    await user.tab()

    await waitFor(() => expect(bridge.books[0].author).toBe('Ursula K. Le Guin'))
  })

  it('abandons the edit on Escape', async () => {
    const user = userEvent.setup()
    const updateBook = vi.fn(async () => null)
    installBridge(
      { books: [makeBook({ id: 1, author: 'Frank Herbert' })], notes: [] },
      { updateBook }
    )
    renderApp(<BookRoute id={1} />, { kind: 'book', id: 1 })

    await user.click(await screen.findByRole('button', { name: 'Frank Herbert' }))
    const field = await screen.findByLabelText('Author')
    await user.clear(field)
    await user.type(field, 'Nobody{Escape}')

    await waitFor(() => expect(screen.getByRole('button', { name: 'Frank Herbert' })).toBeDefined())
    expect(updateBook).not.toHaveBeenCalled()
  })

  // Cleared to null, not `''`: every reader of this field tests for null.
  it('clears the author rather than storing an empty name', async () => {
    const user = userEvent.setup()
    setup()

    await user.click(await screen.findByRole('button', { name: 'Frank Herbert' }))
    await user.clear(await screen.findByLabelText('Author'))
    await user.tab()

    await waitFor(() => expect(bridge.books[0].author).toBeNull())
    expect(await screen.findByRole('button', { name: 'Add author' })).toBeDefined()
  })

  it('leaves the title alone', async () => {
    const user = userEvent.setup()
    setup()

    await user.click(await screen.findByRole('button', { name: 'Frank Herbert' }))
    const field = await screen.findByLabelText('Author')
    await user.clear(field)
    await user.type(field, 'Someone Else{Enter}')

    await waitFor(() => expect(bridge.books[0].author).toBe('Someone Else'))
    expect(bridge.books[0].title).toBe('Dune')
  })

  it('keeps the title editable independently', async () => {
    const user = userEvent.setup()
    setup()

    await user.click(await screen.findByRole('button', { name: 'Dune' }))
    const field = await screen.findByLabelText('Book title')
    await user.clear(field)
    await user.type(field, 'Dune Messiah{Enter}')

    await waitFor(() => expect(bridge.books[0].title).toBe('Dune Messiah'))
    expect(bridge.books[0].author).toBe('Frank Herbert')
  })
})
