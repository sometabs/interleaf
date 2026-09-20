import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import Library from '../src/renderer/src/components/Library'
import { installBridge, makeBook, renderApp } from './helpers/render'

const DUNE = makeBook({ id: 1, title: 'Dune', author: 'Frank Herbert', status: 'read' })
const MESSIAH = makeBook({
  id: 2,
  title: 'Dune Messiah',
  author: 'frank  herbert ',
  status: 'want'
})
const DISPOSSESSED = makeBook({ id: 3, title: 'The Dispossessed', author: 'Ursula K. Le Guin' })
const NAMELESS = makeBook({ id: 4, title: 'A stray paperback', author: null })

// Shelf headings carry a count: "Frank Herbert · 2".
function shelves(): string[] {
  return screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent ?? '')
}

describe('grouping the library by author', () => {
  async function open(books = [DUNE, MESSIAH, DISPOSSESSED, NAMELESS]): Promise<void> {
    const user = userEvent.setup()
    installBridge({ books })
    renderApp(<Library onAdd={() => {}} />)

    await waitFor(() => expect(screen.getByRole('radio', { name: 'Author' })).toBeDefined())
    await user.click(screen.getByRole('radio', { name: 'Author' }))
  }

  it('gives each author a shelf, alphabetically, with the unnamed last', async () => {
    await open()

    await waitFor(() =>
      expect(shelves()).toEqual([
        'Frank Herbert · 2',
        'Ursula K. Le Guin · 1',
        'Unknown author · 1'
      ])
    )
  })

  it('keeps every book on the shelf, not just the first', async () => {
    await open()

    // A grouping divides the library rather than filtering it.
    await waitFor(() => expect(screen.getAllByTestId('cover')).toHaveLength(4))
  })

  it('sits alongside the remaining groupings', async () => {
    await open()

    for (const label of ['Status', 'Author', 'A–Z']) {
      expect(screen.getByRole('radio', { name: label })).toBeDefined()
    }
    expect(screen.getByRole('radio', { name: 'Author' }).getAttribute('aria-checked')).toBe('true')
  })

  it('remembers the chosen grouping', async () => {
    const user = userEvent.setup()
    installBridge({ books: [DUNE, DISPOSSESSED] })
    const first = renderApp(<Library onAdd={() => {}} />)

    await user.click(await screen.findByRole('radio', { name: 'Author' }))
    expect(window.localStorage.getItem('interleaf.libraryGrouping')).toBe('"author"')
    first.unmount()

    renderApp(<Library onAdd={() => {}} />)
    expect(
      (await screen.findByRole('radio', { name: 'Author' })).getAttribute('aria-checked')
    ).toBe('true')
  })

  it('narrows with the search box, which is what filtering is for', async () => {
    const user = userEvent.setup()
    await open()

    await user.type(screen.getByLabelText('Filter library'), 'Herbert')

    await waitFor(() => expect(shelves()).toEqual(['Frank Herbert · 2']))
    expect(screen.getAllByTestId('cover')).toHaveLength(2)
  })

  it('offers no secondary genre filters', async () => {
    await open()

    await waitFor(() => expect(shelves()[0]).toBe('Frank Herbert · 2'))
    expect(screen.queryByRole('group', { name: 'Genre' })).toBeNull()
  })
})
