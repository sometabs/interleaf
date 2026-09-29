import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import App from '../src/renderer/src/App'
import BookDetail from '../src/renderer/src/components/BookDetail'
import Notes from '../src/renderer/src/components/Notes'
import { useBook } from '../src/renderer/src/lib/queries'
import { installBridge, makeBook, makeNote, renderApp, type FakeBridge } from './helpers/render'

function BookRoute({ id }: { id: number }): ReactNode {
  const book = useBook(id)
  return book ? <BookDetail key={id} book={book} /> : null
}

function openCards(): HTMLElement[] {
  return screen.queryAllByTestId('note-card').filter((card) => card.dataset.open === 'true')
}

async function enterLastEditor(text: string): Promise<void> {
  const editors = document.querySelectorAll<HTMLElement>('.note-prose')
  const editor = editors[editors.length - 1]
  if (!editor) throw new Error('No note editor is open')
  await act(async () => {
    editor.innerHTML = `<p>${text}</p>`
    editor.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('writing a note on a book', () => {
  let bridge: FakeBridge

  function setup(notes = [] as ReturnType<typeof makeNote>[]): void {
    bridge = installBridge({ books: [makeBook()], notes })
    renderApp(<BookRoute id={1} />, { kind: 'book', id: 1 })
  }

  it('offers Add note even when the book has none', async () => {
    setup()
    expect(await screen.findByRole('button', { name: 'Add note' })).toBeDefined()
    expect(screen.queryAllByTestId('note-card')).toHaveLength(0)
  })

  it('creates a thought attached to the book', async () => {
    const user = userEvent.setup()
    setup()

    await user.click(await screen.findByRole('button', { name: 'Add note' }))
    expect(bridge.created).toHaveLength(0)
    await user.type(screen.getByLabelText('Note title'), 'Desert politics')
    await user.click(screen.getByRole('button', { name: 'Done' }))

    await waitFor(() =>
      expect(bridge.created).toContainEqual({
        bookId: 1,
        kind: 'thought',
        title: 'Desert politics',
        bodyMd: ''
      })
    )
    expect(bridge.created.every((input) => (input as { kind: string }).kind !== 'review')).toBe(
      true
    )
  })

  it('derives the title when a new book note has only a body', async () => {
    const user = userEvent.setup()
    setup()

    await user.click(await screen.findByRole('button', { name: 'Add note' }))
    await enterLastEditor('A body without a title')
    await user.click(screen.getByRole('button', { name: 'Done' }))

    await waitFor(() => expect(bridge.created).toHaveLength(1))
    expect(bridge.created[0]).toMatchObject({
      bookId: 1,
      kind: 'thought',
      bodyMd: 'A body without a title'
    })
    expect(bridge.created[0]).toHaveProperty('title', undefined)
  })

  it('opens the note in place without leaving the book', async () => {
    const user = userEvent.setup()
    setup()

    await user.click(await screen.findByRole('button', { name: 'Add note' }))

    // Two editors now: the review and the note.
    await waitFor(() => expect(openCards()).toHaveLength(1))
    expect(screen.getByRole('heading', { name: 'The Dispossessed' })).toBeDefined()
    expect(screen.getAllByTestId('editor')).toHaveLength(2)
  })

  it('does not stack up blank notes when Add note is clicked twice', async () => {
    const user = userEvent.setup()
    setup()

    const add = await screen.findByRole('button', { name: 'Add note' })
    await user.click(add)
    await waitFor(() => expect(openCards()).toHaveLength(1))
    await user.click(add)

    expect(openCards()).toHaveLength(1)
    expect(bridge.created).toHaveLength(0)
  })

  it('expands an existing note in place rather than navigating', async () => {
    const user = userEvent.setup()
    setup([makeNote({ id: 7, bookId: 1, title: 'On walls', bodyMd: 'The wall was there.' })])

    await user.click(await screen.findByText('On walls'))

    await waitFor(() => expect(openCards()).toHaveLength(1))
    expect(screen.getByRole('heading', { name: 'The Dispossessed' })).toBeDefined()
  })

  it('discards a new note left blank when Done is clicked', async () => {
    const user = userEvent.setup()
    setup()

    await user.click(await screen.findByRole('button', { name: 'Add note' }))
    await waitFor(() => expect(openCards()).toHaveLength(1))

    await user.click(screen.getByRole('button', { name: 'Done' }))

    await waitFor(() => expect(openCards()).toHaveLength(0))
    expect(bridge.created).toHaveLength(0)
    expect(bridge.deleted).toHaveLength(0)
  })

  it('keeps a note that has text in it', async () => {
    const user = userEvent.setup()
    setup([makeNote({ id: 7, bookId: 1, title: 'On walls', bodyMd: 'The wall was there.' })])

    await user.click(await screen.findByText('On walls'))
    await waitFor(() => expect(openCards()).toHaveLength(1))
    await user.click(screen.getAllByTestId('note-head')[0])

    await waitFor(() => expect(openCards()).toHaveLength(0))
    expect(bridge.deleted).toEqual([])
  })

  it('keeps text when Done beats the autosave timer', async () => {
    const user = userEvent.setup()
    setup([makeNote({ id: 7, bookId: 1, title: '', bodyMd: '' })])

    await user.click(await screen.findByText('Untitled note'))
    await enterLastEditor('Saved on close')
    await user.click(screen.getByRole('button', { name: 'Collapse note' }))

    await waitFor(() => expect(bridge.notes[0].bodyMd).toBe('Saved on close'))
    expect(bridge.deleted).toEqual([])
  })

  it('keeps the note editor mounted while the note list refetches', async () => {
    const user = userEvent.setup()
    setup([makeNote({ id: 7, bookId: 1, title: 'On walls', bodyMd: 'The wall was there.' })])

    await user.click(await screen.findByText('On walls'))
    await waitFor(() => expect(screen.getAllByTestId('editor')).toHaveLength(2))

    const editors = screen.getAllByTestId('editor')
    await user.click(screen.getByRole('button', { name: 'Reading' }))
    await waitFor(() => expect(bridge.books[0].status).toBe('reading'))

    expect(screen.getAllByTestId('editor')).toEqual(editors)
  })
})

describe('Notes index', () => {
  it('lists every note with the book it belongs to', async () => {
    installBridge({
      books: [makeBook()],
      notes: [
        makeNote({ id: 1, title: 'Standalone' }),
        makeNote({ id: 2, bookId: 1, title: 'On walls' })
      ]
    })
    renderApp(<Notes />, { kind: 'notes' })

    await waitFor(() => expect(screen.getAllByTestId('note-row')).toHaveLength(2))
    // Scoped to the rows: the filter above lists every title as an <option>.
    const rows = screen.getAllByTestId('note-row').map((row) => row.textContent ?? '')
    expect(rows.filter((row) => row.includes('The Dispossessed'))).toHaveLength(1)
  })

  // Asserted as position, not as a class: `ml-auto` is how it is pushed there
  // today and the test should survive that changing.
  it('puts the tag last on the bottom line, under the date', async () => {
    installBridge({
      books: [makeBook()],
      notes: [makeNote({ id: 1, bookId: 1, title: 'On walls', tag: 'THEORY' })]
    })
    renderApp(<Notes />, { kind: 'notes' })

    // Scoped to the row: the filter above offers every tag as an <option>.
    const row = await screen.findByTestId('note-row')
    const tag = within(row).getByText('THEORY')

    expect(tag.nextElementSibling).toBeNull()
    expect(tag.parentElement).toBe(row.lastElementChild)
  })

  it('creates a note that belongs to no book', async () => {
    const user = userEvent.setup()
    const bridge = installBridge({ books: [], notes: [] })
    renderApp(<App />, { kind: 'notes' })

    await user.click(await screen.findByRole('button', { name: 'Write your first note' }))
    expect(bridge.created).toHaveLength(0)
    await user.type(await screen.findByLabelText('Note title'), 'Loose thought')
    await user.click(screen.getByRole('button', { name: 'Done' }))

    await waitFor(() =>
      expect(bridge.created).toContainEqual({
        kind: 'thought',
        title: 'Loose thought',
        bodyMd: '',
        tag: null,
        bookId: null
      })
    )
  })

  it('does not create an empty note from the full-page draft', async () => {
    const user = userEvent.setup()
    const bridge = installBridge({ books: [], notes: [] })
    renderApp(<App />, { kind: 'notes' })

    await user.click(await screen.findByRole('button', { name: 'Write your first note' }))
    await user.click(await screen.findByRole('button', { name: 'Done' }))

    await screen.findByRole('heading', { name: 'Notes' })
    expect(bridge.created).toHaveLength(0)
  })
})

describe('searching the notes index', () => {
  async function setup(): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup()
    installBridge({
      books: [makeBook()],
      notes: [
        makeNote({ id: 1, title: 'On walls', bodyMd: 'The wall was ambiguous.', tag: 'utopia' }),
        makeNote({ id: 2, bookId: 1, title: 'Shevek', bodyMd: 'A physicist adrift.' }),
        makeNote({ id: 3, title: 'Groceries', bodyMd: 'Bread, olives.' })
      ]
    })
    renderApp(<Notes />, { kind: 'notes' })
    await waitFor(() => expect(screen.getAllByTestId('note-row')).toHaveLength(3))
    return user
  }

  async function search(user: ReturnType<typeof userEvent.setup>, text: string): Promise<void> {
    await user.type(screen.getByLabelText('Search notes'), text)
  }

  it('narrows by title', async () => {
    const user = await setup()
    await search(user, 'walls')

    await waitFor(() => expect(screen.getAllByTestId('note-row')).toHaveLength(1))
    expect(screen.getByText('On walls')).toBeDefined()
  })

  it('narrows by body text, not just the title', async () => {
    const user = await setup()
    await search(user, 'physicist')

    await waitFor(() => expect(screen.getAllByTestId('note-row')).toHaveLength(1))
    expect(screen.getByText('Shevek')).toBeDefined()
  })

  it('narrows by tag', async () => {
    const user = await setup()
    await search(user, 'utopia')

    await waitFor(() => expect(screen.getAllByTestId('note-row')).toHaveLength(1))
    expect(screen.getByText('On walls')).toBeDefined()
  })

  it('narrows by the book a note belongs to', async () => {
    const user = await setup()
    await search(user, 'dispossessed')

    await waitFor(() => expect(screen.getAllByTestId('note-row')).toHaveLength(1))
    expect(screen.getByText('Shevek')).toBeDefined()
  })

  it('ignores case and surrounding space', async () => {
    const user = await setup()
    await search(user, '  WALLS  ')

    await waitFor(() => expect(screen.getAllByTestId('note-row')).toHaveLength(1))
  })

  it('says so when nothing matches', async () => {
    const user = await setup()
    await search(user, 'zzz')

    await waitFor(() => expect(screen.queryAllByTestId('note-row')).toHaveLength(0))
    expect(screen.getByText(/Nothing matches/)).toBeDefined()
  })

  it('restores the full list when the query is cleared', async () => {
    const user = await setup()
    await search(user, 'walls')
    await waitFor(() => expect(screen.getAllByTestId('note-row')).toHaveLength(1))

    await user.clear(screen.getByLabelText('Search notes'))

    await waitFor(() => expect(screen.getAllByTestId('note-row')).toHaveLength(3))
  })

  it('offers no search box when there is nothing to search', () => {
    installBridge({ books: [], notes: [] })
    renderApp(<Notes />, { kind: 'notes' })

    expect(screen.queryByLabelText('Search notes')).toBeNull()
  })
})

describe('filtering the notes index', () => {
  async function setup(): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup()
    installBridge({
      books: [makeBook({ id: 1, title: 'The Dispossessed' }), makeBook({ id: 2, title: 'Dune' })],
      notes: [
        makeNote({ id: 1, bookId: 1, title: 'On walls', tag: 'THEORY' }),
        makeNote({ id: 2, bookId: 1, title: 'Shevek', tag: 'SUMMARY' }),
        makeNote({ id: 3, bookId: 2, title: 'Spice', tag: 'THEORY' }),
        makeNote({ id: 4, bookId: null, title: 'Groceries', tag: null })
      ]
    })
    renderApp(<Notes />, { kind: 'notes' })
    await waitFor(() => expect(screen.getAllByTestId('note-row')).toHaveLength(4))
    return user
  }

  async function pick(
    user: Awaited<ReturnType<typeof setup>>,
    label: string,
    value: string
  ): Promise<void> {
    await user.selectOptions(screen.getByLabelText(label), value)
  }

  function titles(): string[] {
    return screen.getAllByTestId('note-row').map((row) => row.textContent ?? '')
  }

  it('narrows to one book', async () => {
    const user = await setup()
    await pick(user, 'Filter by book', '1')

    await waitFor(() => expect(screen.getAllByTestId('note-row')).toHaveLength(2))
    expect(titles().join(' ')).toContain('On walls')
    expect(titles().join(' ')).not.toContain('Spice')
  })

  it('narrows to one tag', async () => {
    const user = await setup()
    await pick(user, 'Filter by tag', 'THEORY')

    await waitFor(() => expect(screen.getAllByTestId('note-row')).toHaveLength(2))
    expect(titles().join(' ')).toContain('Spice')
    expect(titles().join(' ')).not.toContain('Shevek')
  })

  it('combines the two rather than replacing one with the other', async () => {
    const user = await setup()
    await pick(user, 'Filter by book', '1')
    await pick(user, 'Filter by tag', 'THEORY')

    await waitFor(() => expect(screen.getAllByTestId('note-row')).toHaveLength(1))
    expect(titles()[0]).toContain('On walls')
  })

  it('finds the notes that belong to no book', async () => {
    const user = await setup()
    await pick(user, 'Filter by book', 'none')

    await waitFor(() => expect(screen.getAllByTestId('note-row')).toHaveLength(1))
    expect(titles()[0]).toContain('Groceries')
  })

  it('finds the notes with no tag', async () => {
    const user = await setup()
    await pick(user, 'Filter by tag', 'none')

    await waitFor(() => expect(screen.getAllByTestId('note-row')).toHaveLength(1))
    expect(titles()[0]).toContain('Groceries')
  })

  it('narrows alongside the search box', async () => {
    const user = await setup()
    await pick(user, 'Filter by tag', 'THEORY')
    await user.type(screen.getByLabelText('Search notes'), 'spice')

    await waitFor(() => expect(screen.getAllByTestId('note-row')).toHaveLength(1))
    expect(titles()[0]).toContain('Spice')
  })

  it('counts what is showing against the whole list', async () => {
    const user = await setup()
    expect(screen.getByText(/4 notes across your library/)).toBeDefined()

    await pick(user, 'Filter by tag', 'THEORY')

    await waitFor(() => expect(screen.getByText('2 of 4 notes')).toBeDefined())
  })

  it('clears every filter at once', async () => {
    const user = await setup()
    await pick(user, 'Filter by book', '2')
    await pick(user, 'Filter by tag', 'THEORY')
    await user.type(screen.getByLabelText('Search notes'), 'spice')
    await waitFor(() => expect(screen.getAllByTestId('note-row')).toHaveLength(1))

    await user.click(screen.getByRole('button', { name: 'Clear' }))

    await waitFor(() => expect(screen.getAllByTestId('note-row')).toHaveLength(4))
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
  })

  it('says so when the filters match nothing', async () => {
    const user = await setup()
    await pick(user, 'Filter by book', '2')
    await pick(user, 'Filter by tag', 'SUMMARY')

    await waitFor(() => expect(screen.getByText(/No notes match these filters/)).toBeDefined())
    expect(screen.queryAllByTestId('note-row')).toHaveLength(0)
  })

  it('offers no filters when there is nothing to filter', () => {
    installBridge({ books: [], notes: [] })
    renderApp(<Notes />, { kind: 'notes' })

    expect(screen.queryByLabelText('Filter by book')).toBeNull()
    expect(screen.queryByLabelText('Filter by tag')).toBeNull()
  })
})
