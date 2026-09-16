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
