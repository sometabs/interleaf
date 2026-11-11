import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ConfirmDialog from '../src/renderer/src/components/ConfirmDialog'
import Library from '../src/renderer/src/components/Library'
import { resetConfirm } from '../src/renderer/src/lib/confirm'
import { installBridge, makeBook, renderApp } from './helpers/render'

afterEach(resetConfirm)

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
  it('previews the cached cover after hovering and hides it when a drag starts', async () => {
    const coverPath = 'book-1-test.jpg'
    installBridge(
      { books: [{ ...SOLARIS, coverPath, pageCount: 96 }] },
      { getSpineColors: async () => ({}) }
    )
    renderApp(<Library onAdd={() => {}} />)
    await userEvent.setup().click(await screen.findByRole('radio', { name: 'Shelf' }))
    const spine = screen.getByRole('button', { name: 'Solaris by Stanisław Lem' })
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

      fireEvent.dragStart(spine, { dataTransfer: { setData: vi.fn() } })
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
    const user = userEvent.setup()
    await user.click(await screen.findByRole('radio', { name: 'Shelf' }))
    const shelf = screen.getByRole('list', { name: 'Shelf 1' })
    const titles = (): string[] =>
      within(shelf)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label') ?? '')
    const wolf = within(shelf).getByRole('button', { name: 'Wolf Hall by Hilary Mantel' })
    const solaris = within(shelf).getByRole('button', { name: 'Solaris by Stanisław Lem' })
    expect(solaris.style.width).toBe('43px')
    await waitFor(() => expect(solaris.style.backgroundColor).toBe('rgb(38, 114, 173)'))
    expect(getSpineColors).toHaveBeenCalledWith([coverPath])
    expect(wolf.style.backgroundColor).toBeTruthy()
    const dataTransfer = { effectAllowed: 'none', dropEffect: 'none', setData: vi.fn() }

    fireEvent.dragStart(wolf, { dataTransfer })
    fireEvent.drop(solaris, { dataTransfer, clientX: -1 })
    expect(titles()).toEqual([
      'Wolf Hall by Hilary Mantel',
      'Solaris by Stanisław Lem',
      'Roadside Picnic by Strugatsky'
    ])

    first.unmount()
    renderApp(<Library onAdd={() => {}} />)
    const restored = await screen.findByRole('list', { name: 'Shelf 1' })
    expect(within(restored).getAllByRole('button')[0].getAttribute('aria-label')).toBe(
      'Wolf Hall by Hilary Mantel'
    )
  })

  it('keeps the previous order and saves a book dropped into open shelf space', async () => {
    window.localStorage.setItem('interleaf.bookshelfOrder', JSON.stringify([3, 2, 1]))
    installBridge({ books: [SOLARIS, PICNIC, HALL] })
    const first = renderApp(<Library onAdd={() => {}} />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('radio', { name: 'Shelf' }))
    const titles = (shelf: string): (string | null)[] =>
      within(screen.getByRole('list', { name: shelf }))
        .queryAllByRole('button')
        .map((button) => button.getAttribute('aria-label'))
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
    expect(solaris().parentElement?.style.getPropertyValue('--shelf-x')).toBe('386px')

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
    expect(solaris().parentElement?.style.getPropertyValue('--shelf-x')).toBe('486px')

    fireEvent.dragStart(solaris(), { dataTransfer })
    dragAt('Shelf 1', 600)
    expect(titles('Shelf 2')).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Remove empty shelf 2' }))
    expect(screen.queryByRole('list', { name: 'Shelf 2' })).toBeNull()
    expect(titles('Shelf 1').at(-1)).toBe('Solaris by Stanisław Lem')
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
    await userEvent.setup().click(await screen.findByRole('radio', { name: 'Shelf' }))
    const first = screen.getByRole('list', { name: 'Shelf 1' })
    const second = screen.getByRole('list', { name: 'Shelf 2' })
    expect(within(first).getAllByRole('button')).toHaveLength(11)
    expect(
      within(first)
        .getByRole('button', { name: 'Book 2' })
        .parentElement?.style.getPropertyValue('--shelf-x')
    ).toBe('54px')
    const lastBook = within(second).getByRole('button', { name: 'Book 12' })
    expect(lastBook.parentElement?.style.getPropertyValue('--shelf-x')).toBe('0px')

    const dataTransfer = { effectAllowed: 'none', dropEffect: 'move', setData: vi.fn() }
    fireEvent.dragStart(lastBook, { dataTransfer })
    fireEvent.dragOver(first, { dataTransfer })
    expect(dataTransfer.dropEffect).toBe('none')
    fireEvent.drop(first, { dataTransfer })
    expect(within(second).getByRole('button', { name: 'Book 12' })).toBe(lastBook)
  })
})

describe('refreshing all metadata', () => {
  it('confirms the permanent action and reports progress', async () => {
    let finish:
      | ((value: { refreshed: number; failures: []; cancelled: boolean; offline: boolean }) => void)
      | null = null
    const refreshAllMetadata = vi.fn(
      () =>
        new Promise<{
          refreshed: number
          failures: []
          cancelled: boolean
          offline: boolean
        }>((resolve) => {
          finish = resolve
        })
    )
    const cancelMetadataRefresh = vi.fn(async () => undefined)
    const bridge = installBridge(
      { books: [SOLARIS, PICNIC, HALL] },
      { refreshAllMetadata, cancelMetadataRefresh }
    )
    renderApp(
      <>
        <Library onAdd={() => {}} />
        <ConfirmDialog />
      </>
    )
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Refresh all metadata' }))
    expect(await screen.findByText('Refresh metadata for all 3 books?')).toBeTruthy()
    expect(refreshAllMetadata).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Refresh all' }))
    await waitFor(() => expect(refreshAllMetadata).toHaveBeenCalledOnce())

    act(() =>
      bridge.emitMetadataRefreshProgress({ done: 1, total: 3, label: 'Refreshing “Solaris”' })
    )
    expect(await screen.findByRole('region', { name: 'Metadata refresh progress' })).toBeTruthy()
    expect(screen.getByText('1 of 3')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Cancel refresh' }))
    expect(cancelMetadataRefresh).toHaveBeenCalledOnce()

    act(() => finish?.({ refreshed: 1, failures: [], cancelled: true, offline: false }))
    expect(await screen.findByText('Refresh stopped after 1 book.')).toBeTruthy()
  })

  it('lists books Open Library could not match', async () => {
    const retryMetadataRefresh = vi.fn(async () => ({
      refreshed: 1,
      failures: [],
      cancelled: false,
      offline: false
    }))
    installBridge(
      { books: [SOLARIS] },
      {
        refreshAllMetadata: async () => ({
          refreshed: 0,
          failures: [
            {
              bookId: 1,
              title: 'Solaris',
              reason: 'Open Library returned no result for this book.'
            }
          ],
          cancelled: false,
          offline: false
        }),
        retryMetadataRefresh
      }
    )
    renderApp(
      <>
        <Library onAdd={() => {}} />
        <ConfirmDialog />
      </>
    )
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Refresh all metadata' }))
    await user.click(await screen.findByRole('button', { name: 'Refresh all' }))

    expect(await screen.findByText(/0 books refreshed; 1 could not be matched/)).toBeTruthy()
    await user.click(screen.getByText('Books needing attention (1)'))
    expect(document.body.textContent).toContain('Open Library returned no result for this book.')

    await user.click(screen.getByRole('button', { name: 'Retry failed books' }))
    await waitFor(() => expect(retryMetadataRefresh).toHaveBeenCalledWith([1]))
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Metadata refresh summary' })).toBeNull()
    )
  })
})
