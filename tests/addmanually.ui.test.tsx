import type { Book } from '@shared/api'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import AddBookDialog from '../src/renderer/src/components/AddBookDialog'
import BookDetail from '../src/renderer/src/components/BookDetail'
import { useBook } from '../src/renderer/src/lib/queries'
import { useView } from '../src/renderer/src/lib/view'
import { installBridge, makeBook, renderApp } from './helpers/render'

// Open Library returns its closest match to any string, so a lookup here would
// attach an unrelated book's details as though they were checked facts.
function Harness({ id }: { id: number }): ReactNode {
  // Left open, Radix marks the page behind it `aria-hidden` and the detail
  // below is invisible to every query.
  const [open, setOpen] = useState(true)
  const { view } = useView()
  const book = useBook(id)

  // Routed rather than mounted: rendering the detail unconditionally leaves
  // the tests green with the navigate() call deleted.
  if (view.kind !== 'book') return <AddBookDialog open={open} onOpenChange={setOpen} />
  return (
    <>
      <AddBookDialog open={open} onOpenChange={setOpen} />
      {book ? <BookDetail key={id} book={book} /> : null}
    </>
  )
}

describe('adding a book by hand', () => {
  function setup(): { enrichBook: ReturnType<typeof vi.fn>; books: Book[] } {
    const books: Book[] = []
    const enrichBook = vi.fn(async (id: number) => {
      const book = books.find((b) => b.id === id)
      if (book) Object.assign(book, { author: 'Cal Newport', publishedYear: 2016, pageCount: 303 })
      return book ?? null
    })

    installBridge(
      { books, notes: [] },
      {
        enrichBook,
        createBook: async (input) => {
          const created = makeBook({ id: 1, title: input.title, author: null, status: 'want' })
          books.push(created)
          return created
        }
      }
    )
    renderApp(<Harness id={1} />, { kind: 'library' })
    return { enrichBook, books }
  }

  async function addByHand(title: string): Promise<void> {
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Search for a book'), title)
    await user.click(await screen.findByRole('button', { name: /manually/ }))
  }

  it('saves exactly what was typed', async () => {
    const { books } = setup()

    await addByHand('Qwerty Nonsense Title')

    await waitFor(() => expect(books).toHaveLength(1))
    expect(books[0].title).toBe('Qwerty Nonsense Title')
    expect(books[0].author).toBeNull()
  })

  it('asks Open Library nothing', async () => {
    const { enrichBook } = setup()

    await addByHand('Qwerty Nonsense Title')

    await waitFor(() => expect(screen.getByRole('button', { name: 'Add author' })).toBeDefined())
    expect(enrichBook).not.toHaveBeenCalled()
  })

  it('invents no author, year or page count', async () => {
    setup()

    await addByHand('Qwerty Nonsense Title')

    expect(await screen.findByRole('button', { name: 'Add author' })).toBeDefined()
    expect(await screen.findByRole('button', { name: 'Year' })).toBeDefined()
    expect(await screen.findByRole('button', { name: 'Pages' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Cal Newport' })).toBeNull()
  })

  it('opens the book so the details can be typed in', async () => {
    setup()

    await addByHand('Qwerty Nonsense Title')

    expect(await screen.findByRole('button', { name: 'Qwerty Nonsense Title' })).toBeDefined()
  })
})
