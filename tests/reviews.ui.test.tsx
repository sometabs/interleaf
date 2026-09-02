import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import App from '../src/renderer/src/App'
import Notes from '../src/renderer/src/components/Notes'
import Reviews from '../src/renderer/src/components/Reviews'
import Sidebar from '../src/renderer/src/components/Sidebar'
import { installBridge, makeBook, makeNote, renderApp } from './helpers/render'

// A review is a note of kind `review`, shown apart from the rest.

const BOOK = makeBook({ id: 7, title: 'The Dispossessed', rating: 5, finishedAt: 1_700_000_000 })

const REVIEW = makeNote({ id: 1, kind: 'review', bookId: 7, bodyMd: 'An ambiguous utopia.' })
const THOUGHT = makeNote({ id: 2, kind: 'thought', title: 'On walls', bodyMd: 'A thought.' })
const QUOTE = makeNote({ id: 3, kind: 'highlight', bookId: 7, bodyMd: 'There was a wall.' })

describe('the Reviews screen', () => {
  it('shows reviews and nothing else', async () => {
    installBridge({ books: [BOOK], notes: [REVIEW, THOUGHT, QUOTE] })
    renderApp(<Reviews />, { kind: 'reviews' })

    expect(await screen.findByText(/An ambiguous utopia/)).toBeTruthy()
    expect(screen.queryByText(/A thought\./)).toBeNull()
    expect(screen.queryByText(/There was a wall/)).toBeNull()
  })

  it('shows the book, its rating and when it was finished', async () => {
    installBridge({ books: [BOOK], notes: [REVIEW] })
    renderApp(<Reviews />, { kind: 'reviews' })

    const row = await screen.findByTestId('review-row')
    expect(row.textContent).toContain('The Dispossessed')
    expect(row.textContent).toContain('Ursula K. Le Guin')
    expect(within(row).getByRole('img', { name: 'Rated 5 of 5' })).toBeTruthy()
  })

  it('orders them by the date the book was finished, newest first', async () => {
    installBridge({
      books: [
        makeBook({ id: 1, title: 'Older', finishedAt: 1_600_000_000 }),
        makeBook({ id: 2, title: 'Newer', finishedAt: 1_700_000_000 }),
        makeBook({ id: 3, title: 'Undated', finishedAt: null })
      ],
      notes: [
        makeNote({ id: 10, kind: 'review', bookId: 1, bodyMd: 'One.' }),
        makeNote({ id: 11, kind: 'review', bookId: 2, bodyMd: 'Two.' }),
        makeNote({ id: 12, kind: 'review', bookId: 3, bodyMd: 'Three.' })
      ]
    })
    renderApp(<Reviews />, { kind: 'reviews' })

    await screen.findByText(/One\./)
    const titles = screen.getAllByTestId('review-row').map((row) => row.textContent)
    expect(titles[0]).toContain('Newer')
    expect(titles[1]).toContain('Older')
    // Undated last, not first: a missing date is not the oldest date.
    expect(titles[2]).toContain('Undated')
  })

  it('hides a review whose book is gone', async () => {
    installBridge({ books: [], notes: [REVIEW] })
    renderApp(<Reviews />, { kind: 'reviews' })

    expect(await screen.findByText('No reviews yet')).toBeTruthy()
    expect(screen.queryByTestId('review-row')).toBeNull()
  })

  it('narrows to one rating', async () => {
    installBridge({
      books: [
        makeBook({ id: 1, title: 'Loved it', rating: 5 }),
        makeBook({ id: 2, title: 'Fine', rating: 3 })
      ],
      notes: [
        makeNote({ id: 10, kind: 'review', bookId: 1, bodyMd: 'One.' }),
        makeNote({ id: 11, kind: 'review', bookId: 2, bodyMd: 'Two.' })
      ]
    })
    renderApp(<Reviews />, { kind: 'reviews' })
    const user = userEvent.setup()

    await user.selectOptions(await screen.findByLabelText('Filter by rating'), '5')

    expect(screen.getByText(/One\./)).toBeTruthy()
    expect(screen.queryByText(/Two\./)).toBeNull()
  })

  it('searches the book as well as the review', async () => {
    installBridge({
      books: [
        makeBook({ id: 1, title: 'The Dispossessed' }),
        makeBook({ id: 2, title: 'Solaris' })
      ],
      notes: [
        makeNote({ id: 10, kind: 'review', bookId: 1, bodyMd: 'One.' }),
        makeNote({ id: 11, kind: 'review', bookId: 2, bodyMd: 'Two.' })
      ]
    })
    renderApp(<Reviews />, { kind: 'reviews' })
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Search reviews'), 'solaris')

    expect(screen.getByText(/Two\./)).toBeTruthy()
    expect(screen.queryByText(/One\./)).toBeNull()
  })

  it('opens the review on its own screen', async () => {
    installBridge({ books: [BOOK], notes: [REVIEW] })
    renderApp(<App />, { kind: 'reviews' })
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('review-row'))

    expect(await screen.findByRole('heading', { name: 'The Dispossessed' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open the book →' })).toBeTruthy()
    // The book page and everything editable on it stay one step away.
    expect(screen.queryByLabelText('Reading status')).toBeNull()
  })
})

describe('the Notes screen', () => {
  it('no longer lists reviews', async () => {
    installBridge({ books: [BOOK], notes: [REVIEW, THOUGHT] })
    renderApp(<Notes />, { kind: 'notes' })

    expect(await screen.findByText(/A thought\./)).toBeTruthy()
    expect(screen.queryByText(/An ambiguous utopia/)).toBeNull()
  })
})

describe('Sidebar', () => {
  it('counts reviews and thoughts apart', async () => {
    installBridge({ books: [BOOK], notes: [REVIEW, THOUGHT, QUOTE] })
    renderApp(<Sidebar onAdd={() => {}} onPalette={() => {}} />)

    const reviews = await screen.findByRole('button', { name: /^Reviews/ })
    const notes = await screen.findByRole('button', { name: /^Notes/ })

    await waitFor(() => expect(reviews.textContent).toBe('Reviews1'))
    expect(notes.textContent).toBe('Notes1')
  })
})

describe('the back control on a book', () => {
  it('returns to Reviews from a review', async () => {
    installBridge({ books: [BOOK], notes: [REVIEW] })
    renderApp(<App />, { kind: 'reviews' })
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('review-row'))
    await user.click(await screen.findByRole('button', { name: '← Reviews' }))

    expect(await screen.findByRole('heading', { name: 'Reviews' })).toBeTruthy()
  })

  it('names the review when a book was opened from one', async () => {
    installBridge({ books: [BOOK], notes: [REVIEW] })
    renderApp(<App />, { kind: 'reviews' })
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('review-row'))
    await user.click(await screen.findByRole('button', { name: 'Open the book →' }))

    expect(await screen.findByRole('button', { name: '← Back' })).toBeTruthy()
  })

  it('says Library when the book is the first screen', async () => {
    installBridge({ books: [BOOK], notes: [REVIEW] })
    renderApp(<App />, { kind: 'book', id: 7 })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: '← Library' }))

    expect(await screen.findByRole('heading', { name: 'Library' })).toBeTruthy()
  })
})

describe('the review screen', () => {
  it('carries the book as context, with no way to move the review', async () => {
    installBridge({ books: [BOOK], notes: [REVIEW] })
    renderApp(<App />, { kind: 'review', id: 1 })

    expect(await screen.findByRole('heading', { name: 'The Dispossessed' })).toBeTruthy()
    // A book has at most one review, so offering to move it offers a failure.
    expect(screen.queryByLabelText('Book this note is about')).toBeNull()
  })

  it('rates the book from here', async () => {
    const state = installBridge({ books: [makeBook({ id: 7, rating: null })], notes: [REVIEW] })
    renderApp(<App />, { kind: 'review', id: 1 })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: '4 stars' }))

    await waitFor(() => expect(state.books[0].rating).toBe(4))
  })

  it('deletes the review and keeps the book', async () => {
    const state = installBridge({ books: [BOOK], notes: [REVIEW] })
    renderApp(<App />, { kind: 'review', id: 1 })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await user.click(await screen.findByRole('button', { name: 'Delete review' }))

    await waitFor(() => expect(state.deleted).toEqual([1]))
    expect(state.books).toHaveLength(1)
    expect(await screen.findByRole('heading', { name: 'Reviews' })).toBeTruthy()
  })

  it('says so when the book has been deleted underneath it', async () => {
    installBridge({ books: [], notes: [REVIEW] })
    renderApp(<App />, { kind: 'review', id: 1 })

    expect(await screen.findByText('The book this review belongs to is gone.')).toBeTruthy()
  })
})
