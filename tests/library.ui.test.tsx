import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Library from '../src/renderer/src/components/Library'
import { installBridge, makeBook, renderApp } from './helpers/render'

// The grouping rules themselves are covered in `shelves.test.ts`.

const SOLARIS = makeBook({
  id: 1,
  title: 'Solaris',
  author: 'Stanisław Lem',
  status: 'read',
  genres: ['Science Fiction']
})
const PICNIC = makeBook({
  id: 2,
  title: 'Roadside Picnic',
  author: 'Strugatsky',
  status: 'reading',
  genres: ['Science Fiction', 'Thriller & Suspense']
})
const HALL = makeBook({
  id: 3,
  title: 'Wolf Hall',
  author: 'Hilary Mantel',
  status: 'want',
  genres: ['Historical Fiction']
})

function show(): ReturnType<typeof userEvent.setup> {
  installBridge({ books: [SOLARIS, PICNIC, HALL] })
  renderApp(<Library onAdd={() => {}} />)
  return userEvent.setup()
}

// Shelf headings read "Label · count" and are the only h2 on the page.
async function headings(): Promise<string[]> {
  const found = await screen.findAllByRole('heading', { level: 2 })
  return found.map((node) => node.textContent ?? '')
}

describe('grouping the library', () => {
  it('groups by status until told otherwise', async () => {
    show()

    expect(await headings()).toEqual(['Reading · 1', 'Want to read · 1', 'Read · 1'])
    expect(screen.queryByRole('button', { name: 'Refresh all metadata' })).toBeNull()
  })

  it('does not offer the removed Category grouping or embed the priority queue', async () => {
    show()

    expect(screen.queryByRole('radio', { name: 'Category' })).toBeNull()
    expect(screen.queryByLabelText('Priority reading order')).toBeNull()
  })

  it('regroups alphabetically on request, ignoring a leading article', async () => {
    const user = show()

    await user.click(await screen.findByRole('radio', { name: 'A–Z' }))

    expect(await headings()).toEqual(['R · 1', 'S · 1', 'W · 1'])
  })

  it('marks the active grouping for assistive technology', async () => {
    const user = show()
    const control = await screen.findByRole('radiogroup', { name: 'Group by' })

    await user.click(within(control).getByRole('radio', { name: 'Author' }))

    expect(within(control).getByRole('radio', { name: 'Author' })).toHaveProperty(
      'ariaChecked',
      'true'
    )
    expect(within(control).getByRole('radio', { name: 'Status' })).toHaveProperty(
      'ariaChecked',
      'false'
    )
  })

  it('goes back to status without losing a book', async () => {
    const user = show()

    await user.click(await screen.findByRole('radio', { name: 'A–Z' }))
    await user.click(await screen.findByRole('radio', { name: 'Status' }))

    expect(await headings()).toEqual(['Reading · 1', 'Want to read · 1', 'Read · 1'])
    expect(screen.queryByRole('button', { name: 'Refresh all metadata' })).toBeNull()
  })
})

describe('filtering inside a grouping', () => {
  it('narrows the shelves rather than the covers', async () => {
    const user = show()

    await user.type(await screen.findByLabelText('Filter library'), 'wolf')

    await waitFor(async () => expect(await headings()).toEqual(['Want to read · 1']))
    expect(screen.queryByText('Solaris')).toBeNull()
  })

  it('says so when nothing matches', async () => {
    const user = show()

    await user.type(await screen.findByLabelText('Filter library'), 'zzz')

    expect(await screen.findByText(/Nothing matches/)).toBeTruthy()
  })
})

describe('arranging the bookshelf', () => {
  beforeEach(() => {
    window.localStorage.setItem('interleaf.libraryLayout', '"shelf"')
  })

  function shelfTitles(shelf: HTMLElement): (string | null)[] {
    return Array.from(shelf.querySelectorAll('button[draggable]'), (button) =>
      button.getAttribute('aria-label')
    )
  }

  function chooseBookAction(book: HTMLElement, name: string): void {
    fireEvent.contextMenu(book)
    fireEvent.click(screen.getByRole('menuitem', { name }))
  }

  it('finds books in shelf order while keeping their neighbors and shelf navigation visible', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    const saved = JSON.stringify([
      { id: 1, name: 'Favorites', bookIds: [2, 3], positions: {} },
      { id: 2, name: 'Favorites from this year', bookIds: [1], positions: {} }
    ])
    window.localStorage.setItem('interleaf.bookshelves', saved)
    window.localStorage.setItem('interleaf.bookshelfHidden', '[4]')
    const bridge = installBridge({
      books: [
        SOLARIS,
        { ...PICNIC, author: 'Stanisław Strugatsky' },
        HALL,
        makeBook({ id: 4, title: 'Hidden book', author: 'Stanisław Lem' })
      ]
    })
    renderApp(<Library onAdd={() => {}} />)
    const user = userEvent.setup()

    try {
      const search = await screen.findByRole('textbox', { name: 'Find books on shelves' })
      const picnic = await screen.findByRole('button', {
        name: 'Roadside Picnic by Stanisław Strugatsky'
      })
      const solaris = screen.getByRole('button', { name: 'Solaris by Stanisław Lem' })
      const wolf = screen.getByRole('button', { name: 'Wolf Hall by Hilary Mantel' })
      await user.type(search, 'stanisław')
      await waitFor(() =>
        expect(scroll).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
      )
      expect(scroll.mock.contexts.at(-1)).toBe(picnic)
      expect(picnic.hasAttribute('data-search-match')).toBe(true)
      expect(solaris.hasAttribute('data-search-match')).toBe(true)
      expect(wolf.hasAttribute('data-search-match')).toBe(false)
      expect(screen.getByRole('status').textContent).toBe('2 matches')

      await user.click(screen.getByRole('button', { name: 'Jump to shelf' }))
      const picker = screen.getByRole('dialog', { name: 'Jump to shelf' })
      await user.click(within(picker).getByRole('button', { name: 'Favorites from this year' }))
      expect(scroll).toHaveBeenLastCalledWith({
        block: 'start',
        inline: 'nearest',
        behavior: 'smooth'
      })
      expect(scroll.mock.contexts.at(-1)).toBe(solaris.closest('[data-shelf-id]'))
      expect(search).toHaveProperty('value', 'stanisław')

      await user.type(search, 'zzz')
      expect(screen.getByRole('status').textContent).toBe('No matches')
      expect(solaris.isConnected).toBe(true)
      expect(solaris.hasAttribute('data-search-match')).toBe(false)
      await user.clear(search)
      expect(screen.getByRole('status').textContent).toBe('')
      expect(window.localStorage.getItem('interleaf.bookshelves')).toBeNull()
      expect(window.localStorage.getItem('interleaf.bookshelfHidden')).toBeNull()
      expect(bridge.bookshelf).toMatchObject({ shelves: JSON.parse(saved), hiddenBookIds: [4] })
    } finally {
      scroll.mockRestore()
    }
  })

  it('shows the right hover preview for both orientations and hides it when a drag starts', async () => {
    const coverPath = 'book-1-test.jpg'
    installBridge(
      { books: [{ ...SOLARIS, coverPath, pageCount: 96 }] },
      { getSpineColors: async () => ({}) }
    )
    renderApp(<Library onAdd={() => {}} />)
    const spine = await screen.findByRole('button', { name: 'Solaris by Stanisław Lem' })
    expect(spine.style.width).toBe('38px')
    expect(spine.querySelector('.book-spine-author')?.textContent).toBe('Stanisław Lem')

    vi.useFakeTimers()
    try {
      fireEvent.mouseEnter(spine)
      expect(screen.queryByText('Solaris', { selector: 'p' })).toBeNull()
      fireEvent.mouseLeave(spine)
      act(() => vi.runOnlyPendingTimers())
      expect(screen.queryByText('Solaris', { selector: 'p' })).toBeNull()

      fireEvent.mouseEnter(spine)
      act(() => vi.runOnlyPendingTimers())
      const preview = screen.getByText('Solaris', { selector: 'p' }).closest('[aria-hidden="true"]')
      expect(preview?.querySelector('img')?.getAttribute('src')).toBe(
        `bookcover://covers/${coverPath}`
      )
      expect(preview?.textContent).toContain('Stanisław Lem')
      expect(preview?.querySelector('p:last-child')?.textContent).toBe('Read')

      fireEvent.dragStart(spine, { dataTransfer: { setData: vi.fn() } })
      expect(screen.queryByText('Solaris', { selector: 'p' })).toBeNull()
      fireEvent.dragEnd(spine)

      vi.useRealTimers()
      chooseBookAction(spine, 'Show cover')
      await within(spine).findByTestId('cover')
      vi.useFakeTimers()
      fireEvent.mouseEnter(spine)
      act(() => vi.advanceTimersByTime(399))
      expect(screen.queryByText('Solaris', { selector: 'p' })).toBeNull()
      act(() => vi.advanceTimersByTime(1))
      const textPreview = screen
        .getByText('Solaris', { selector: 'p' })
        .closest('[aria-hidden="true"]')
      expect(textPreview?.textContent).toContain('Stanisław Lem')
      expect(textPreview?.querySelector('p:last-child')?.textContent).toBe('Read')
      expect(textPreview?.querySelector('img')).toBeNull()
      fireEvent.mouseLeave(spine)
      expect(screen.queryByText('Solaris', { selector: 'p' })).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('saves the shelf order after dragging a book', async () => {
    const coverPath = 'book-1-test.jpg'
    const getSpineColors = vi.fn(async () => ({
      [coverPath]: { cover: '#2672ad', ink: '#ffffff', detail: '#f3cd50' }
    }))
    installBridge({ books: [{ ...SOLARIS, coverPath }, PICNIC, HALL] }, { getSpineColors })
    const first = renderApp(<Library onAdd={() => {}} />)
    const shelf = await screen.findByRole('list', { name: 'Shelf 1' })
    const titles = (): (string | null)[] => shelfTitles(shelf)
    const wolf = within(shelf).getByRole('button', { name: 'Wolf Hall by Hilary Mantel' })
    const solaris = within(shelf).getByRole('button', { name: 'Solaris by Stanisław Lem' })
    expect(solaris.style.width).toBe('43px')
    await waitFor(() => expect(solaris.style.backgroundColor).toBe('rgb(38, 114, 173)'))
    expect(getSpineColors).toHaveBeenCalledWith([coverPath])
    expect(wolf.style.backgroundColor).toBeTruthy()
    const dataTransfer = { effectAllowed: 'none', dropEffect: 'none', setData: vi.fn() }

    fireEvent.dragStart(wolf, { dataTransfer })
    fireEvent.drop(solaris, { dataTransfer, clientX: -1 })
    await waitFor(() =>
      expect(titles()).toEqual([
        'Wolf Hall by Hilary Mantel',
        'Solaris by Stanisław Lem',
        'Roadside Picnic by Strugatsky'
      ])
    )

    first.unmount()
    renderApp(<Library onAdd={() => {}} />)
    const restored = await screen.findByRole('list', { name: 'Shelf 1' })
    expect(shelfTitles(restored)[0]).toBe('Wolf Hall by Hilary Mantel')
  })

  it('keeps the previous order and saves a book dropped into open shelf space', async () => {
    window.localStorage.setItem('interleaf.bookshelfOrder', JSON.stringify([3, 2, 1]))
    installBridge({ books: [SOLARIS, PICNIC, HALL] })
    const first = renderApp(<Library onAdd={() => {}} />)
    const user = userEvent.setup()
    await screen.findByRole('list', { name: 'Shelf 1' })
    const titles = (shelf: string): (string | null)[] =>
      shelfTitles(screen.getByRole('list', { name: shelf }))
    expect(titles('Shelf 1')).toEqual([
      'Wolf Hall by Hilary Mantel',
      'Roadside Picnic by Strugatsky',
      'Solaris by Stanisław Lem'
    ])

    await user.click(screen.getByRole('button', { name: 'Add shelf' }))
    expect(titles('Shelf 2')).toEqual([])
    const dataTransfer = { effectAllowed: 'none', dropEffect: 'none', setData: vi.fn() }
    const solaris = (): HTMLElement =>
      screen.getByRole('button', { name: 'Solaris by Stanisław Lem' })
    function dragAt(shelf: string, x: number, type: 'dragover' | 'drop' = 'drop'): HTMLElement {
      const track = screen.getByRole('list', { name: shelf })
      const strip = track.firstElementChild!
      vi.spyOn(track, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 0, 660, 217))
      vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue(new DOMRect(114, 0, 632, 217))
      const event = new MouseEvent(type, { bubbles: true, clientX: x })
      fireEvent(strip, Object.assign(event, { dataTransfer }))
      return track.parentElement!.querySelector('.bookshelf-drop-preview')!
    }

    fireEvent.dragStart(solaris(), { dataTransfer })
    const outline = dragAt('Shelf 2', 400, 'dragover')
    expect(outline.hasAttribute('data-active')).toBe(true)
    expect(outline.style.transform).toBe('translateX(300px)')
    expect(dragAt('Shelf 2', 500, 'dragover')).toBe(outline)
    expect(outline.style.transform).toBe('translateX(400px)')
    dragAt('Shelf 2', 500)
    expect(outline.hasAttribute('data-active')).toBe(false)
    await waitFor(() =>
      expect(solaris().parentElement?.style.getPropertyValue('--shelf-x')).toBe('386px')
    )

    first.unmount()
    renderApp(<Library onAdd={() => {}} />)
    await screen.findByRole('list', { name: 'Shelf 2' })
    expect(titles('Shelf 1')).toEqual([
      'Wolf Hall by Hilary Mantel',
      'Roadside Picnic by Strugatsky'
    ])
    expect(titles('Shelf 2')).toEqual(['Solaris by Stanisław Lem'])
    expect(solaris().parentElement?.style.getPropertyValue('--shelf-x')).toBe('386px')

    fireEvent.dragStart(solaris(), { dataTransfer })
    dragAt('Shelf 2', 600)
    await waitFor(() =>
      expect(solaris().parentElement?.style.getPropertyValue('--shelf-x')).toBe('486px')
    )

    fireEvent.dragStart(solaris(), { dataTransfer })
    dragAt('Shelf 1', 600)
    await waitFor(() => expect(titles('Shelf 2')).toEqual([]))
    await user.click(screen.getByRole('button', { name: 'Remove empty shelf 2' }))
    expect(screen.queryByRole('list', { name: 'Shelf 2' })).toBeNull()
    expect(titles('Shelf 1').at(-1)).toBe('Solaris by Stanisław Lem')
  })

  it('remembers shelf names and row order without moving the books within each shelf', async () => {
    window.localStorage.setItem(
      'interleaf.bookshelves',
      JSON.stringify([
        { id: 1, bookIds: [1], positions: { 1: 110 } },
        { id: 2, bookIds: [2], positions: { 2: 250 } }
      ])
    )
    installBridge({ books: [SOLARIS, PICNIC] })
    const first = renderApp(<Library onAdd={() => {}} />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Shelf 2' }))
    await user.type(screen.getByRole('textbox', { name: 'Name for shelf 2' }), 'Favorites{Enter}')

    const lists = (): (string | null)[] =>
      within(screen.getByRole('region', { name: 'Bookshelf' }))
        .getAllByRole('list')
        .map((list) => list.getAttribute('aria-label'))
    expect(lists()).toEqual(['Shelf 1', 'Favorites'])
    await user.click(screen.getByRole('button', { name: 'Move Favorites up' }))
    expect(lists()).toEqual(['Favorites', 'Shelf 2'])

    first.unmount()
    renderApp(<Library onAdd={() => {}} />)
    const favorites = await screen.findByRole('list', { name: 'Favorites' })
    expect(lists()).toEqual(['Favorites', 'Shelf 2'])
    expect(
      within(favorites)
        .getByRole('button', { name: 'Roadside Picnic by Strugatsky' })
        .parentElement?.style.getPropertyValue('--shelf-x')
    ).toBe('250px')

    const dataTransfer = { effectAllowed: 'none', dropEffect: 'none', setData: vi.fn() }
    const solaris = screen.getByRole('button', { name: 'Solaris by Stanisław Lem' })
    fireEvent.dragStart(solaris, { dataTransfer })
    fireEvent.drop(favorites.firstElementChild!, { dataTransfer })
    expect(
      await within(favorites).findByRole('button', { name: 'Solaris by Stanisław Lem' })
    ).toBeTruthy()
    expect(lists()).toEqual(['Favorites', 'Shelf 2'])

    await user.click(screen.getByRole('button', { name: 'Move Favorites down' }))
    await user.click(screen.getByRole('button', { name: 'Favorites' }))
    await user.clear(screen.getByRole('textbox', { name: 'Name for shelf 2' }))
    await user.keyboard('{Enter}')
    expect(lists()).toEqual(['Shelf 1', 'Shelf 2'])
  })

  it('turns a book to its cached cover and remembers which way it faces', async () => {
    installBridge({ books: [{ ...SOLARIS, coverPath: 'book-1-test.jpg' }, PICNIC] })
    const first = renderApp(<Library onAdd={() => {}} />)
    const label = 'Solaris by Stanisław Lem'
    const solaris = await screen.findByRole('button', { name: label })
    chooseBookAction(solaris, 'Show cover')
    await within(solaris).findByTestId('cover')
    expect(solaris.style.width).toBe('112px')
    expect(within(solaris).getByTestId('cover').querySelector('img')?.getAttribute('src')).toBe(
      'bookcover://covers/book-1-test.jpg'
    )
    expect(
      screen
        .getByRole('button', { name: 'Roadside Picnic by Strugatsky' })
        .parentElement?.style.getPropertyValue('--shelf-x')
    ).toBe('112px')

    first.unmount()
    renderApp(<Library onAdd={() => {}} />)
    const restored = await screen.findByRole('button', { name: label })
    expect(within(restored).getByTestId('cover')).toBeTruthy()
    chooseBookAction(restored, 'Show spine')
    await waitFor(() => expect(within(restored).queryByTestId('cover')).toBeNull())
    expect(restored.style.width).toBe('43px')
  })

  it('wraps a full shelf for a face-out book and restores the row when it turns back', async () => {
    const books = Array.from({ length: 11 }, (_, index) =>
      makeBook({ id: index + 1, title: `Book ${index + 1}`, author: null, pageCount: 900 })
    )
    installBridge({ books })
    renderApp(<Library onAdd={() => {}} />)
    const book = await screen.findByRole('button', { name: 'Book 1' })
    const first = screen.getByRole('list', { name: 'Shelf 1' })
    chooseBookAction(book, 'Show cover')
    await within(book).findByTestId('cover')
    expect(within(first).getAllByRole('listitem')).toHaveLength(10)
    expect(within(book).getByTestId('cover')).toBeTruthy()
    expect(
      within(screen.getByRole('list', { name: 'Shelf 1, row 2' })).getByRole('button', {
        name: 'Book 11'
      })
    ).toBeTruthy()

    chooseBookAction(book, 'Show spine')
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Shelf 1, row 2' })).toBeNull())
    expect(within(first).getAllByRole('listitem')).toHaveLength(11)
  })

  it('hides books only from the shelf, supports Undo, and appends books added back', async () => {
    window.localStorage.setItem(
      'interleaf.bookshelves',
      JSON.stringify([
        { id: 1, name: 'Favorites', bookIds: [1], positions: { 1: 110 } },
        { id: 2, bookIds: [2, 3], positions: { 2: 0, 3: 180 } }
      ])
    )
    const library = installBridge({ books: [SOLARIS, PICNIC, HALL] })
    const user = userEvent.setup()
    const first = renderApp(<Library onAdd={() => {}} />)
    const label = 'Solaris by Stanisław Lem'
    chooseBookAction(await screen.findByRole('button', { name: label }), 'Hide from shelf')
    await waitFor(() => expect(screen.queryByRole('button', { name: label })).toBeNull())
    expect(library.deleted).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    const favorites = within(screen.getByRole('list', { name: 'Favorites' }))
    expect(
      favorites
        .getByRole('button', { name: label })
        .parentElement?.style.getPropertyValue('--shelf-x')
    ).toBe('110px')

    chooseBookAction(screen.getByRole('button', { name: label }), 'Hide from shelf')
    await waitFor(() => expect(screen.queryByRole('button', { name: label })).toBeNull())
    chooseBookAction(
      screen.getByRole('button', { name: 'Roadside Picnic by Strugatsky' }),
      'Hide from shelf'
    )
    await waitFor(() => expect(library.bookshelf?.hiddenBookIds).toEqual([1, 2]))
    first.unmount()
    renderApp(<Library onAdd={() => {}} />)
    await user.click(await screen.findByRole('button', { name: 'Add to shelf' }))
    const search = screen.getByRole('combobox', { name: 'Search hidden books' })
    await user.type(search, 'lem')
    expect(screen.queryByRole('option', { name: /Roadside Picnic/ })).toBeNull()
    await user.click(screen.getByRole('option', { name: /Solaris/ }))
    expect(shelfTitles(screen.getByRole('list', { name: 'Shelf 2' }))).toEqual([
      'Wolf Hall by Hilary Mantel',
      label
    ])
    expect(library.books).toHaveLength(3)
  })

  it('opens the book menu from the keyboard and returns focus on Escape', async () => {
    installBridge({ books: [SOLARIS] })
    renderApp(<Library onAdd={() => {}} />)
    const user = userEvent.setup()
    const solaris = await screen.findByRole('button', { name: 'Solaris by Stanisław Lem' })
    solaris.focus()
    await user.keyboard('{Shift>}{F10}{/Shift}')
    const menu = screen.getByRole('menu', { name: 'Options for Solaris' })
    expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'Show cover' }))
    expect(within(solaris).queryByTestId('cover')).toBeNull()
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(
      within(menu).getByRole('menuitem', { name: 'Start a stack' })
    )
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(
      within(menu).getByRole('menuitem', { name: 'Hide from shelf' })
    )
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(solaris))

    await user.keyboard('{Shift>}{F10}{/Shift}{ArrowDown}{Enter}')
    const stacked = within(await screen.findByRole('group', { name: 'Book stack' })).getByRole(
      'button',
      {
        name: 'Solaris by Stanisław Lem'
      }
    )
    await waitFor(() => expect(document.activeElement).toBe(stacked))
  })

  it('saves horizontal stacks and keeps books flat when dragged out or slid along a shelf', async () => {
    window.localStorage.setItem(
      'interleaf.bookshelves',
      JSON.stringify([
        { id: 1, name: 'Favorites', bookIds: [1, 2], positions: { 1: 70, 2: 320 } },
        { id: 2, bookIds: [3], positions: { 3: 30 } }
      ])
    )
    installBridge({ books: [SOLARIS, PICNIC, HALL] })
    const first = renderApp(<Library onAdd={() => {}} />)
    const solaris = await screen.findByRole('button', { name: 'Solaris by Stanisław Lem' })
    chooseBookAction(solaris, 'Start a stack')
    const pile = await screen.findByRole('group', { name: 'Book stack' })
    expect(
      within(pile).getByRole('button', { name: 'Solaris by Stanisław Lem' }).style.height
    ).toBe('43px')
    const dataTransfer = { effectAllowed: 'none', dropEffect: 'none', setData: vi.fn() }
    const wolf = 'Wolf Hall by Hilary Mantel'
    fireEvent.dragStart(screen.getByRole('button', { name: wolf }), { dataTransfer })
    fireEvent.drop(within(pile).getByText('Drop onto stack'), { dataTransfer })
    await waitFor(() => expect(shelfTitles(pile)).toEqual(['Solaris by Stanisław Lem', wolf]))

    first.unmount()
    renderApp(<Library onAdd={() => {}} />)
    const restored = await screen.findByRole('group', { name: 'Book stack' })
    expect(shelfTitles(restored)).toEqual(['Solaris by Stanisław Lem', wolf])
    const user = userEvent.setup()
    chooseBookAction(within(restored).getByRole('button', { name: wolf }), 'Hide from shelf')
    await waitFor(() => expect(within(restored).queryByRole('button', { name: wolf })).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(shelfTitles(restored)).toEqual(['Solaris by Stanisław Lem', wolf])

    const stackedWolf = within(restored).getByRole('button', { name: wolf })
    const { width, height } = stackedWolf.style
    fireEvent.dragStart(stackedWolf, { dataTransfer })
    const second = screen.getByRole('list', { name: 'Shelf 2' })
    fireEvent.dragOver(second.firstElementChild!, { dataTransfer })
    const outline = second.parentElement!.querySelector<HTMLElement>('.bookshelf-drop-preview')!
    expect(outline.style.width).toBe(width)
    expect(outline.style.height).toBe(height)
    const drop = new MouseEvent('drop', { bubbles: true, clientX: 175 })
    fireEvent(second.firstElementChild!, Object.assign(drop, { dataTransfer }))
    await waitFor(() => expect(shelfTitles(restored)).toEqual(['Solaris by Stanisław Lem']))
    const flat = within(second).getByRole('group', { name: 'Book stack' })
    const flatWolf = within(flat).getByRole('button', { name: wolf })
    expect(flatWolf.classList.contains('book-spine-horizontal')).toBe(true)
    expect(flat.parentElement?.style.getPropertyValue('--shelf-x')).toBe('175px')

    fireEvent.dragStart(flatWolf, { dataTransfer })
    const slide = new MouseEvent('drop', { bubbles: true, clientX: 210 })
    fireEvent(flatWolf, Object.assign(slide, { dataTransfer }))
    await waitFor(() =>
      expect(flat.parentElement?.style.getPropertyValue('--shelf-x')).toBe('210px')
    )
    expect(shelfTitles(flat)).toEqual([wolf])

    chooseBookAction(flatWolf, 'Stand upright')
    await waitFor(() =>
      expect(within(second).queryByRole('group', { name: 'Book stack' })).toBeNull()
    )
    chooseBookAction(
      within(restored).getByRole('button', { name: 'Solaris by Stanisław Lem' }),
      'Stand upright'
    )
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Book stack' })).toBeNull())
    expect(shelfTitles(screen.getByRole('list', { name: 'Favorites' }))).toEqual([
      'Solaris by Stanisław Lem',
      'Roadside Picnic by Strugatsky'
    ])
  })

  it('rejects a drop onto a stack that would exceed the shelf height', async () => {
    const books = Array.from({ length: 4 }, (_, index) =>
      makeBook({ id: index + 1, title: `Book ${index + 1}`, author: null, pageCount: 900 })
    )
    installBridge({ books })
    renderApp(<Library onAdd={() => {}} />)
    chooseBookAction(await screen.findByRole('button', { name: 'Book 1' }), 'Start a stack')
    const pile = within(await screen.findByRole('group', { name: 'Book stack' }))
    const dataTransfer = { effectAllowed: 'none', dropEffect: 'none', setData: vi.fn() }
    for (const name of ['Book 2', 'Book 3']) {
      fireEvent.dragStart(screen.getByRole('button', { name }), { dataTransfer })
      fireEvent.drop(pile.getByText('Drop onto stack'), { dataTransfer })
      await pile.findByRole('button', { name })
    }
    const fourth = screen.getByRole('button', { name: 'Book 4' })
    fireEvent.dragStart(fourth, { dataTransfer })
    const target = pile.getByText('Stack is full')
    fireEvent.dragOver(target, { dataTransfer })
    expect(dataTransfer.dropEffect).toBe('none')
    fireEvent.drop(target, { dataTransfer })
    expect(pile.getAllByRole('button')).toHaveLength(3)
    expect(pile.queryByRole('button', { name: 'Book 4' })).toBeNull()
    expect(fourth.isConnected).toBe(true)
  })

  it('wraps with the available width and keeps edits in the same named shelf', async () => {
    let width = 700
    let resize: () => void = () => {}
    const clientWidth = vi
      .spyOn(Element.prototype, 'clientWidth', 'get')
      .mockImplementation(function (this: Element) {
        return this.classList.contains('bookshelf') ? width : 0
      })
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize = callback
        }
        observe = vi.fn()
        disconnect = vi.fn()
      }
    )
    const books = Array.from({ length: 8 }, (_, index) =>
      makeBook({ id: index + 1, title: `Book ${index + 1}`, author: null, pageCount: 900 })
    )
    const storageKey = 'interleaf.bookshelves'
    const saved = JSON.stringify([
      { id: 1, name: 'Favorites', bookIds: [1, 2, 3, 4, 5, 6, 7], positions: { 7: 360 } },
      { id: 2, name: 'Other books', bookIds: [8], positions: {} }
    ])
    window.localStorage.setItem(storageKey, saved)
    const bridge = installBridge({ books })

    try {
      renderApp(<Library onAdd={() => {}} />)
      const favorites = await screen.findByRole('list', { name: 'Favorites' })
      const bookLabels = (list: HTMLElement): (string | null)[] =>
        within(list)
          .getAllByRole('button')
          .map((book) => book.getAttribute('aria-label'))
      expect(bookLabels(favorites)).toHaveLength(7)

      width = 220
      act(() => resize())
      const continuation = screen.getByRole('list', { name: 'Favorites, row 2' })
      expect(favorites.closest('.bookshelf-row')?.hasAttribute('data-continues')).toBe(true)
      expect(continuation.closest('.bookshelf-row')?.hasAttribute('data-continues')).toBe(false)
      expect(bookLabels(favorites)).toEqual(['Book 1', 'Book 2', 'Book 3', 'Book 4'])
      expect(bookLabels(continuation)).toEqual(['Book 5', 'Book 6', 'Book 7'])
      expect(bridge.bookshelf?.shelves).toMatchObject(JSON.parse(saved))

      const book = screen.getByRole('button', { name: 'Book 8' })
      const dataTransfer = { effectAllowed: 'none', dropEffect: 'none', setData: vi.fn() }
      fireEvent.dragStart(book, { dataTransfer })
      const drop = new MouseEvent('drop', { bubbles: true, clientX: 216 })
      fireEvent(continuation.firstElementChild!, Object.assign(drop, { dataTransfer }))
      await waitFor(() =>
        expect(bookLabels(continuation)).toEqual(['Book 5', 'Book 6', 'Book 7', 'Book 8'])
      )
      expect(bridge.bookshelf?.shelves).toMatchObject([
        { id: 1, name: 'Favorites', bookIds: [1, 2, 3, 4, 5, 6, 7, 8] },
        { id: 2, name: 'Other books', bookIds: [] }
      ])

      width = 700
      act(() => resize())
      expect(screen.queryByRole('list', { name: 'Favorites, row 2' })).toBeNull()
      expect(bookLabels(favorites)).toEqual(books.map(({ title }) => title))
    } finally {
      clientWidth.mockRestore()
    }
  })

  it('moves a book to the end of a named shelf from its keyboard menu and remembers the move', async () => {
    window.localStorage.setItem(
      'interleaf.bookshelves',
      JSON.stringify([
        { id: 1, name: 'To sort', bookIds: [1, 2], positions: { 2: 170 } },
        { id: 2, name: 'Favorites', bookIds: [3], positions: { 3: 90 } }
      ])
    )
    installBridge({ books: [SOLARIS, PICNIC, HALL] })
    const first = renderApp(<Library onAdd={() => {}} />)
    const user = userEvent.setup()
    const label = 'Solaris by Stanisław Lem'
    const solaris = await screen.findByRole('button', { name: label })

    act(() => solaris.focus())
    await user.keyboard('{Shift>}{F10}{/Shift}{ArrowDown}{ArrowDown}{Enter}')
    const destinations = screen.getByRole('menu', { name: 'Move to shelf' })
    expect(within(destinations).queryByRole('menuitem', { name: 'To sort' })).toBeNull()
    expect(document.activeElement).toBe(
      within(destinations).getByRole('menuitem', { name: 'Favorites' })
    )
    await user.keyboard('{Enter}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(
      within(screen.getByRole('list', { name: 'To sort' })).queryByRole('button', { name: label })
    ).toBeNull()

    first.unmount()
    renderApp(<Library onAdd={() => {}} />)
    const favorites = await screen.findByRole('list', { name: 'Favorites' })
    expect(
      within(favorites)
        .getAllByRole('button')
        .map((book) => book.getAttribute('aria-label'))
    ).toEqual(['Wolf Hall by Hilary Mantel', label])
  })

  it('wraps a saved stack together and moves only the selected member to another shelf', async () => {
    const books = Array.from({ length: 13 }, (_, index) =>
      makeBook({ id: index + 1, title: `Book ${index + 1}`, author: null, pageCount: 900 })
    )
    window.localStorage.setItem(
      'interleaf.bookshelves',
      JSON.stringify([
        {
          id: 1,
          name: 'First shelf',
          bookIds: books.slice(0, 12).map(({ id }) => id),
          positions: { '-1': 486 },
          stacks: [{ id: -1, bookIds: [10, 11] }]
        },
        { id: 2, name: 'Favorites', bookIds: [13], positions: {} }
      ])
    )
    installBridge({ books })
    const first = renderApp(<Library onAdd={() => {}} />)
    const user = userEvent.setup()
    const continuation = await screen.findByRole('list', { name: 'First shelf, row 2' })
    const stack = within(continuation).getByRole('group', { name: 'Book stack' })
    expect(shelfTitles(stack)).toEqual(['Book 10', 'Book 11'])

    chooseBookAction(within(stack).getByRole('button', { name: 'Book 11' }), 'Move to shelf…')
    await user.click(screen.getByRole('menuitem', { name: 'Favorites' }))
    expect(shelfTitles(stack)).toEqual(['Book 10'])

    first.unmount()
    renderApp(<Library onAdd={() => {}} />)
    const favorites = await screen.findByRole('list', { name: 'Favorites' })
    expect(shelfTitles(favorites)).toEqual(['Book 13', 'Book 11'])
    expect(shelfTitles(within(favorites).getByRole('group', { name: 'Book stack' }))).toEqual([
      'Book 11'
    ])
    const restored = screen.getByRole('list', { name: 'First shelf, row 2' })
    expect(shelfTitles(within(restored).getByRole('group', { name: 'Book stack' }))).toEqual([
      'Book 10'
    ])
  })

  it('fits an older wide row and rejects drops onto a full shelf', async () => {
    const books = Array.from({ length: 12 }, (_, index) =>
      makeBook({ id: index + 1, title: `Book ${index + 1}`, author: null, pageCount: 900 })
    )
    window.localStorage.setItem(
      'interleaf.bookshelves',
      JSON.stringify([{ id: 1, bookIds: books.map((book) => book.id), positions: { 12: 800 } }])
    )
    installBridge({ books })
    renderApp(<Library onAdd={() => {}} />)
    const first = await screen.findByRole('list', { name: 'Shelf 1' })
    const second = screen.getByRole('list', { name: 'Shelf 1, row 2' })
    expect(within(first).getAllByRole('listitem')).toHaveLength(11)
    expect(
      within(first)
        .getByRole('button', { name: 'Book 2' })
        .parentElement?.style.getPropertyValue('--shelf-x')
    ).toBe('54px')
    const lastBook = within(second).getByRole('button', { name: 'Book 12' })
    expect(lastBook.parentElement?.style.getPropertyValue('--shelf-x')).toBe('206px')

    const dataTransfer = { effectAllowed: 'none', dropEffect: 'move', setData: vi.fn() }
    fireEvent.dragStart(lastBook, { dataTransfer })
    fireEvent.dragOver(first, { dataTransfer })
    expect(dataTransfer.dropEffect).toBe('none')
    fireEvent.drop(first, { dataTransfer })
    expect(within(second).getByRole('button', { name: 'Book 12' })).toBe(lastBook)
  })
})
