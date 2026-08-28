import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import BookDetail from '../src/renderer/src/components/BookDetail'
import Notes from '../src/renderer/src/components/Notes'
import Quotes from '../src/renderer/src/components/Quotes'
import Sidebar from '../src/renderer/src/components/Sidebar'
import { installBridge, makeBook, makeNote, renderApp } from './helpers/render'

// Quotes are notes of kind `highlight`, shown apart from the rest.

const QUOTE = makeNote({
  id: 1,
  kind: 'highlight',
  title: 'The wall was ambiguous',
  bodyMd: 'There was a wall. It did not look important.'
})

const THOUGHT = makeNote({ id: 2, kind: 'thought', title: 'On walls', bodyMd: 'A thought.' })
const REVIEW = makeNote({ id: 3, kind: 'review', title: 'Review', bodyMd: 'Very good.' })

describe('the Quotes screen', () => {
  it('shows quotes and nothing else', async () => {
    installBridge({ notes: [QUOTE, THOUGHT, REVIEW] })
    renderApp(<Quotes />, { kind: 'quotes' })

    expect(await screen.findByText(/There was a wall/)).toBeTruthy()
    expect(screen.queryByText(/A thought\./)).toBeNull()
    expect(screen.queryByText(/Very good\./)).toBeNull()
  })

  it('leads with the passage rather than a title', async () => {
    installBridge({ notes: [QUOTE] })
    renderApp(<Quotes />, { kind: 'quotes' })

    const row = await screen.findByTestId('quote-body')
    expect(row.textContent).toContain('There was a wall')
  })

  it('keeps a new quote as a highlight, not a note', async () => {
    const state = installBridge({ notes: [QUOTE] })
    renderApp(<Quotes />, { kind: 'quotes' })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'New quote' }))

    await waitFor(() => expect(state.created).toHaveLength(1))
    expect(state.created[0]).toMatchObject({ kind: 'highlight' })
  })

  // The book filter is the only thing on screen naming a book, so a quote
  // typed under it starts there.
  it('starts a new quote on whichever book the list is narrowed to', async () => {
    const state = installBridge({
      books: [makeBook({ id: 7, title: 'The Dispossessed' })],
      notes: [QUOTE]
    })
    renderApp(<Quotes />, { kind: 'quotes' })
    const user = userEvent.setup()

    await user.selectOptions(await screen.findByLabelText('Filter by book'), '7')
    await user.click(screen.getByRole('button', { name: 'New quote' }))

    await waitFor(() => expect(state.created).toHaveLength(1))
    expect(state.created[0]).toMatchObject({ kind: 'highlight', bookId: 7 })
  })

  it('opens the passage in place rather than on a page of its own', async () => {
    installBridge({ notes: [QUOTE] })
    renderApp(<Quotes />, { kind: 'quotes' })
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('quote-body'))

    await waitFor(() => expect(screen.getByTestId('quote-card').dataset.open).toBe('true'))
    expect(screen.getByLabelText('Book this quote is from')).toBeTruthy()
  })
})

// jsdom loads no stylesheet, so these check that the rule exists and that the
// element asks for it, rather than measuring a width.
describe('a quote with no spaces in it', () => {
  const UNBROKEN = makeNote({
    id: 4,
    kind: 'highlight',
    bodyMd: 'Bladnaiudazihdahzdiazdazudazidbaziudbazudadabdhadyadaduavdazudhazvduhadadun'
  })

  it('asks to wrap and to shrink', async () => {
    installBridge({ notes: [UNBROKEN] })
    renderApp(<Quotes />, { kind: 'quotes' })

    const preview = (await screen.findByTestId('quote-body')).firstElementChild
    expect(preview?.className).toContain('wrap-anywhere')
    expect(preview?.className).toContain('min-w-0')
  })

  it('wraps in the editor too', async () => {
    const fs = await import('node:fs')
    const css = fs.readFileSync('src/renderer/src/assets/main.css', 'utf8')
    const block = /\.note-prose \{[\s\S]*?\n {2}\}/.exec(css)

    expect(block?.[0]).toContain('overflow-wrap: anywhere')
  })
})

describe('the Notes screen', () => {
  it('no longer lists quotes', async () => {
    installBridge({ notes: [QUOTE, THOUGHT] })
    renderApp(<Notes />, { kind: 'notes' })

    expect(await screen.findByText('On walls')).toBeTruthy()
    expect(screen.queryByText('The wall was ambiguous')).toBeNull()
  })

  // Only quotes leave, because they appear elsewhere; a review would be lost.
  it('still lists reviews', async () => {
    installBridge({ notes: [QUOTE, REVIEW] })
    renderApp(<Notes />, { kind: 'notes' })

    expect(await screen.findByText('Review')).toBeTruthy()
  })

  it('counts what it shows', async () => {
    installBridge({ notes: [QUOTE, THOUGHT] })
    renderApp(<Notes />, { kind: 'notes' })

    expect(await screen.findByText('1 note across your library')).toBeTruthy()
  })
})

describe('the sidebar', () => {
  it('counts quotes and notes apart', async () => {
    installBridge({ notes: [QUOTE, THOUGHT, REVIEW] })
    renderApp(<Sidebar onAdd={() => {}} onPalette={() => {}} />, { kind: 'library' })

    const quotes = await screen.findByRole('button', { name: /^Quotes/ })
    const notes = screen.getByRole('button', { name: /^Notes/ })

    await waitFor(() => expect(quotes.textContent).toBe('Quotes1'))
    expect(notes.textContent).toBe('Notes2')
  })
})

describe('a book page', () => {
  const BOOK = makeBook({ id: 7, title: 'The Dispossessed' })

  it('keeps the book’s quotes out of its notes', async () => {
    installBridge({
      books: [BOOK],
      notes: [
        { ...QUOTE, bookId: 7 },
        { ...THOUGHT, bookId: 7 }
      ]
    })
    renderApp(<BookDetail book={BOOK} />, { kind: 'book', id: 7 })

    expect(await screen.findByTestId('quote-card')).toBeTruthy()
    const cards = screen.getAllByTestId('note-card')
    expect(cards).toHaveLength(1)
    expect(cards[0].textContent).toContain('On walls')
  })

  it('adds a quote to the book it was opened from', async () => {
    const state = installBridge({ books: [BOOK], notes: [] })
    renderApp(<BookDetail book={BOOK} />, { kind: 'book', id: 7 })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Add quote' }))

    await waitFor(() => expect(state.created).toHaveLength(1))
    expect(state.created[0]).toMatchObject({ kind: 'highlight', bookId: 7 })
  })
})
