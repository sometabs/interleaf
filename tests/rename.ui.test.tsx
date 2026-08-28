import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import BookDetail from '../src/renderer/src/components/BookDetail'
import NoteView from '../src/renderer/src/components/NoteView'
import { useBook } from '../src/renderer/src/lib/queries'
import { installBridge, makeBook, makeNote, renderApp, type FakeBridge } from './helpers/render'

function BookRoute({ id }: { id: number }): ReactNode {
  const book = useBook(id)
  return book ? <BookDetail key={id} book={book} /> : null
}

describe('renaming a note from its own page', () => {
  let bridge: FakeBridge

  function setup(overrides = {}): void {
    bridge = installBridge({
      books: [],
      notes: [
        makeNote({ id: 10, title: 'On walls', bodyMd: 'The wall was ambiguous.', ...overrides })
      ]
    })
    renderApp(<NoteView noteId={10} />, { kind: 'note', id: 10 })
  }

  it('stores the new title', async () => {
    const user = userEvent.setup()
    setup()

    await user.click(await screen.findByRole('button', { name: 'On walls' }))
    const field = await screen.findByLabelText('Note title')
    await user.clear(field)
    await user.type(field, 'Ambiguity{Enter}')

    await waitFor(() => expect(bridge.notes[0].title).toBe('Ambiguity'))
    expect(await screen.findByRole('button', { name: 'Ambiguity' })).toBeDefined()
  })

  it('commits when the field loses focus', async () => {
    const user = userEvent.setup()
    setup()

    await user.click(await screen.findByRole('button', { name: 'On walls' }))
    await user.type(await screen.findByLabelText('Note title'), '!')
    await user.tab()

    await waitFor(() => expect(bridge.notes[0].title).toBe('On walls!'))
  })

  it('abandons the draft on Escape', async () => {
    const user = userEvent.setup()
    setup()

    await user.click(await screen.findByRole('button', { name: 'On walls' }))
    const field = await screen.findByLabelText('Note title')
    await user.clear(field)
    await user.type(field, 'Never saved{Escape}')

    await waitFor(() => expect(screen.getByRole('button', { name: 'On walls' })).toBeDefined())
    expect(bridge.notes[0].title).toBe('On walls')
  })

  it('writes nothing when the title comes back unchanged', async () => {
    const user = userEvent.setup()
    // An unchanged write is invisible in the stored note, so only the absence
    // of the call proves it.
    const updateNote = vi.fn(async () => null)
    installBridge({ books: [], notes: [makeNote({ id: 10, title: 'On walls' })] }, { updateNote })
    renderApp(<NoteView noteId={10} />, { kind: 'note', id: 10 })

    await user.click(await screen.findByRole('button', { name: 'On walls' }))
    await user.type(await screen.findByLabelText('Note title'), '{Enter}')

    await waitFor(() => expect(screen.getByRole('button', { name: 'On walls' })).toBeDefined())
    expect(updateNote).not.toHaveBeenCalled()
  })

  it('offers a placeholder for a note that has no title yet', async () => {
    const user = userEvent.setup()
    setup({ title: '' })

    await user.click(await screen.findByRole('button', { name: 'Untitled' }))
    await user.type(await screen.findByLabelText('Note title'), 'First thoughts{Enter}')

    await waitFor(() => expect(bridge.notes[0].title).toBe('First thoughts'))
  })
})

describe('renaming a note from the book page', () => {
  let bridge: FakeBridge

  function setup(): void {
    bridge = installBridge({
      books: [makeBook()],
      notes: [makeNote({ id: 7, bookId: 1, title: 'On walls', bodyMd: 'The wall was there.' })]
    })
    renderApp(<BookRoute id={1} />, { kind: 'book', id: 1 })
  }

  async function openTitle(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
    await user.click(await screen.findByText('On walls'))
    await user.click(await screen.findByRole('button', { name: 'On walls' }))
    return screen.findByLabelText('Note title')
  }

  it('renames the note that is open', async () => {
    const user = userEvent.setup()
    setup()

    const field = await openTitle(user)
    await user.clear(field)
    await user.type(field, 'Ambiguity{Enter}')

    await waitFor(() => expect(bridge.notes[0].title).toBe('Ambiguity'))
  })

  it('leaves the note body alone while renaming', async () => {
    const user = userEvent.setup()
    setup()

    const field = await openTitle(user)
    await user.clear(field)
    await user.type(field, 'Ambiguity{Enter}')

    await waitFor(() => expect(bridge.notes[0].title).toBe('Ambiguity'))
    expect(bridge.notes[0].bodyMd).toBe('The wall was there.')
  })

  it('does not expose a rename control on a collapsed note', async () => {
    setup()

    // Collapsed, the whole row is one button named for all of its text.
    await screen.findByText('On walls')
    expect(screen.queryByLabelText('Note title')).toBeNull()
    expect(screen.queryByRole('button', { name: 'On walls' })).toBeNull()
  })

  it('keeps the book title editable too', async () => {
    const user = userEvent.setup()
    setup()

    await user.click(await screen.findByRole('button', { name: 'The Dispossessed' }))
    const field = await screen.findByLabelText('Book title')
    await user.clear(field)
    await user.type(field, 'The Left Hand of Darkness{Enter}')

    await waitFor(() => expect(bridge.books[0].title).toBe('The Left Hand of Darkness'))
  })

  it('refuses to blank out a book title', async () => {
    const user = userEvent.setup()
    setup()

    await user.click(await screen.findByRole('button', { name: 'The Dispossessed' }))
    const field = await screen.findByLabelText('Book title')
    await user.clear(field)
    await user.type(field, '{Enter}')

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'The Dispossessed' })).toBeDefined()
    )
    expect(bridge.books[0].title).toBe('The Dispossessed')
  })
})
