import { act, screen, waitFor, within } from '@testing-library/react'
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

  it('regroups by category on request', async () => {
    const user = show()

    await user.click(await screen.findByRole('radio', { name: 'Category' }))

    expect(await headings()).toEqual([
      'Science Fiction · 2',
      'Historical Fiction · 1',
      'Thriller & Suspense · 1'
    ])
  })

  it('regroups alphabetically on request, ignoring a leading article', async () => {
    const user = show()

    await user.click(await screen.findByRole('radio', { name: 'A–Z' }))

    expect(await headings()).toEqual(['R · 1', 'S · 1', 'W · 1'])
  })

  it('marks the active grouping for assistive technology', async () => {
    const user = show()
    const control = await screen.findByRole('radiogroup', { name: 'Group by' })

    await user.click(within(control).getByRole('radio', { name: 'Category' }))

    expect(within(control).getByRole('radio', { name: 'Category' })).toHaveProperty(
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

    await user.click(await screen.findByRole('radio', { name: 'Category' }))
    await user.type(screen.getByLabelText('Filter library'), 'wolf')

    await waitFor(async () => expect(await headings()).toEqual(['Historical Fiction · 1']))
    expect(screen.queryByText('Solaris')).toBeNull()
  })

  it('says so when nothing matches', async () => {
    const user = show()

    await user.type(await screen.findByLabelText('Filter library'), 'zzz')

    expect(await screen.findByText(/Nothing matches/)).toBeTruthy()
  })
})

describe('a library the reader has not categorised', () => {
  it('explains the category view instead of filing everything automatically', async () => {
    installBridge({ books: [makeBook({ id: 10, title: 'Unfiled' })] })
    renderApp(<Library onAdd={() => {}} />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('radio', { name: 'Category' }))

    expect(await screen.findByText(/not been categorised yet/)).toBeTruthy()
  })

  it('stays quiet when the reader chose categories', async () => {
    const user = show()

    await user.click(await screen.findByRole('radio', { name: 'Category' }))
    await screen.findByText('Science Fiction · 2')

    expect(screen.queryByText(/not been categorised yet/)).toBeNull()
  })
})

describe('filtering by group, then by genre', () => {
  const MEMOIR = makeBook({
    id: 4,
    title: "Can't Hurt Me",
    author: 'David Goggins',
    genres: ['Biography & Memoir', 'Sports']
  })
  const MIXED = [SOLARIS, PICNIC, HALL, MEMOIR]

  async function openCategory(): Promise<ReturnType<typeof userEvent.setup>> {
    installBridge({ books: MIXED })
    renderApp(<Library onAdd={() => {}} />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('radio', { name: 'Category' }))
    return user
  }

  async function genreChips(): Promise<string[]> {
    const row = await screen.findByRole('group', { name: 'Genre' })
    return within(row)
      .getAllByRole('button')
      .map((node) => node.textContent ?? '')
  }

  it('offers the two groups only in the category view', async () => {
    const user = await openCategory()
    expect(screen.getByRole('radiogroup', { name: 'Group' })).toBeTruthy()

    await user.click(screen.getByRole('radio', { name: 'Status' }))

    expect(screen.queryByRole('radiogroup', { name: 'Group' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Genre' })).toBeNull()
  })

  it('narrows to fiction, and the genre row follows', async () => {
    const user = await openCategory()

    await user.click(screen.getByRole('radio', { name: 'Fiction' }))

    await waitFor(async () =>
      expect(await genreChips()).toEqual([
        'All genres',
        'Science Fiction',
        'Historical Fiction',
        'Thriller & Suspense'
      ])
    )
    expect(screen.queryByText("Can't Hurt Me")).toBeNull()
  })

  it('offers only the other half under non-fiction', async () => {
    const user = await openCategory()

    await user.click(screen.getByRole('radio', { name: 'Non-fiction' }))

    await waitFor(async () =>
      expect(await genreChips()).toEqual(['All genres', 'Biography & Memoir', 'Sports'])
    )
    expect(await headings()).toEqual(['Biography & Memoir · 1', 'Sports · 1'])
  })

  it('then narrows to a single genre, shown as one shelf', async () => {
    const user = await openCategory()

    await user.click(screen.getByRole('radio', { name: 'Fiction' }))
    await user.click(await screen.findByRole('button', { name: 'Thriller & Suspense' }))

    expect(await headings()).toEqual(['Thriller & Suspense · 1'])
    // The title appears twice per card: on the cover and beneath it.
    expect(screen.getAllByText('Roadside Picnic').length).toBeGreaterThan(0)
    expect(screen.queryByText('Solaris')).toBeNull()
  })

  it('clears the genre when the group changes, so no empty grid can appear', async () => {
    const user = await openCategory()

    await user.click(screen.getByRole('radio', { name: 'Fiction' }))
    await user.click(await screen.findByRole('button', { name: 'Science Fiction' }))
    await user.click(screen.getByRole('radio', { name: 'Non-fiction' }))

    expect(await headings()).toEqual(['Biography & Memoir · 1', 'Sports · 1'])
  })

  it('forgets the genre when the group changes, rather than reviving it later', async () => {
    const user = await openCategory()

    await user.click(await screen.findByRole('button', { name: 'Science Fiction' }))
    await user.click(screen.getByRole('radio', { name: 'Non-fiction' }))
    await user.click(screen.getByRole('radio', { name: 'Fiction' }))

    await waitFor(async () =>
      expect(await headings()).toEqual([
        'Science Fiction · 2',
        'Historical Fiction · 1',
        'Thriller & Suspense · 1'
      ])
    )
    expect(await screen.findByRole('button', { name: 'All genres' })).toHaveProperty(
      'ariaPressed',
      'true'
    )
  })

  it('drops a genre that the search box has filtered out of existence', async () => {
    const user = await openCategory()

    await user.click(await screen.findByRole('button', { name: 'Thriller & Suspense' }))
    await user.type(screen.getByLabelText('Filter library'), 'solaris')

    // The selected genre no longer exists here, so it must fall back to what
    // does match rather than to an empty page.
    await waitFor(async () => expect(await headings()).toEqual(['Science Fiction · 1']))
  })

  it('toggles a genre off when it is pressed again', async () => {
    const user = await openCategory()

    await user.click(await screen.findByRole('button', { name: 'Science Fiction' }))
    expect(await headings()).toEqual(['Science Fiction · 2'])

    await user.click(await screen.findByRole('button', { name: 'Science Fiction' }))
    expect((await headings()).length).toBeGreaterThan(1)
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
