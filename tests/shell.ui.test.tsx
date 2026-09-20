import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import App from '../src/renderer/src/App'
import Library from '../src/renderer/src/components/Library'
import Sidebar from '../src/renderer/src/components/Sidebar'
import { installBridge, makeBook, makeNote, renderApp } from './helpers/render'

// Every component mounted at least once: a render crash is invisible to both
// the type checker and the linter.
describe('Sidebar', () => {
  it('collapses to an icon rail and can be reopened', async () => {
    installBridge()
    renderApp(<App />)
    const user = userEvent.setup()
    const shell = document.querySelector('.app-shell')

    expect(shell?.getAttribute('data-sidebar-expanded')).toBe('true')
    await user.click(await screen.findByRole('button', { name: 'Hide sidebar' }))

    expect(shell?.getAttribute('data-sidebar-expanded')).toBe('false')
    expect(screen.getByRole('button', { name: 'Library' })).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Show sidebar' }))
    expect(shell?.getAttribute('data-sidebar-expanded')).toBe('true')
  })

  it('remembers that the sidebar was collapsed', async () => {
    installBridge()
    const first = renderApp(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Hide sidebar' }))
    expect(window.localStorage.getItem('interleaf.sidebarExpanded')).toBe('false')
    first.unmount()

    renderApp(<App />)
    expect(document.querySelector('.app-shell')?.getAttribute('data-sidebar-expanded')).toBe(
      'false'
    )
    expect(await screen.findByRole('button', { name: 'Show sidebar' })).toBeDefined()
  })

  it('mounts with an empty library without logging an error', async () => {
    const errors: unknown[] = []
    vi.spyOn(console, 'error').mockImplementation((...args) => void errors.push(args))

    installBridge()
    renderApp(<Sidebar onAdd={() => {}} onPalette={() => {}} />)

    await waitFor(() => expect(screen.getByText('Library')).toBeDefined())
    expect(errors).toHaveLength(0)
  })

  it('shows a count beside Library and Notes', async () => {
    installBridge({
      books: [makeBook({ id: 1 }), makeBook({ id: 2 })],
      notes: [makeNote({ id: 1 })]
    })
    renderApp(<Sidebar onAdd={() => {}} onPalette={() => {}} />)

    const library = await screen.findByRole('button', { name: /^Library/ })
    const notes = await screen.findByRole('button', { name: /^Notes/ })

    await waitFor(() => expect(library.textContent).toBe('Library2'))
    expect(notes.textContent).toBe('Notes1')
  })

  it('marks the section matching the current view', async () => {
    installBridge({ books: [makeBook()] })
    renderApp(<Sidebar onAdd={() => {}} onPalette={() => {}} />, { kind: 'book', id: 1 })

    const library = await screen.findByRole('button', { name: /^Library/ })
    expect(library.getAttribute('aria-current')).toBe('page')
  })

  it('reaches the add dialog from the footer button', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    installBridge()
    renderApp(<Sidebar onAdd={onAdd} onPalette={() => {}} />)

    await user.click(await screen.findByRole('button', { name: 'Add book' }))
    expect(onAdd).toHaveBeenCalledOnce()
  })
})

describe('Library', () => {
  it('invites the first book when empty', async () => {
    installBridge()
    renderApp(<Library onAdd={() => {}} />)

    expect(await screen.findByText('Your library is empty')).toBeDefined()
  })

  it('groups books under their shelf', async () => {
    installBridge({
      books: [
        makeBook({ id: 1, title: 'Reading one', status: 'reading' }),
        makeBook({ id: 2, title: 'Read one', status: 'read' }),
        makeBook({ id: 3, title: 'Read two', status: 'read' })
      ]
    })
    renderApp(<Library onAdd={() => {}} />)

    expect(await screen.findByText('Reading · 1')).toBeDefined()
    expect(screen.getByText('Read · 2')).toBeDefined()
    expect(screen.queryByText(/^Set aside/)).toBeNull()
  })

  it('filters by title and author', async () => {
    const user = userEvent.setup()
    installBridge({
      books: [
        makeBook({ id: 1, title: 'The Dispossessed', author: 'Le Guin' }),
        makeBook({ id: 2, title: 'Dune', author: 'Herbert' })
      ]
    })
    renderApp(<Library onAdd={() => {}} />)

    // By role, not text: the generated cover renders the title too, but
    // aria-hidden, so only the real entry has an accessible name.
    await screen.findByRole('button', { name: /The Dispossessed/ })
    await user.type(screen.getByLabelText('Filter library'), 'herbert')

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /The Dispossessed/ })).toBeNull()
    )
    expect(screen.getByRole('button', { name: /Dune/ })).toBeDefined()
  })

  it('says so when the filter matches nothing', async () => {
    const user = userEvent.setup()
    installBridge({ books: [makeBook()] })
    renderApp(<Library onAdd={() => {}} />)

    await screen.findByRole('button', { name: /The Dispossessed/ })
    await user.type(screen.getByLabelText('Filter library'), 'zzzz')

    expect(await screen.findByText(/Nothing matches/)).toBeDefined()
  })
})
