import type { DataCounts, DismissedBook } from '@shared/api'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ConfirmDialog from '../src/renderer/src/components/ConfirmDialog'
import { resetConfirm } from '../src/renderer/src/lib/confirm'
import { resetMessages } from '../src/renderer/src/lib/feedback'
import Data from '../src/renderer/src/components/Data'
import Toasts from '../src/renderer/src/components/Toasts'
import { installBridge, renderApp } from './helpers/render'

// The confirm store is outside React and allows one question at a time, so an
// unanswered dialog swallows the next test's.
afterEach(() => {
  resetConfirm()
  resetMessages()
})

function setup(
  counts: Partial<DataCounts> = {},
  dismissed: DismissedBook[] = [],
  overrides = {}
): Record<string, ReturnType<typeof vi.fn>> {
  const spies = {
    deleteAllBooks: vi.fn(async () => counts.books ?? 0),
    deleteAllThoughts: vi.fn(async () => counts.notes ?? 0),
    deleteAllQuotes: vi.fn(async () => counts.quotes ?? 0),
    deleteAllReviews: vi.fn(async () => counts.reviews ?? 0),
    clearRecommendationCache: vi.fn(async () => counts.candidates ?? 0),
    deleteEverything: vi.fn(async () => undefined),
    restoreDismissed: vi.fn(async () => undefined),
    exportBackup: vi.fn(async () => ({
      dir: 'C:/backup',
      books: 2,
      notes: 5,
      covers: 4,
      files: 3
    })),
    restoreBackup: vi.fn(async () => ({ books: 2, notes: 5, covers: 4, replaced: 'C:/old.bak' }))
  }

  installBridge(
    {},
    {
      dataCounts: async () => ({
        books: counts.books ?? 0,
        notes: counts.notes ?? 0,
        quotes: counts.quotes ?? 0,
        reviews: counts.reviews ?? 0,
        candidates: counts.candidates ?? 0,
        dismissed: counts.dismissed ?? dismissed.length
      }),
      listDismissed: async () => dismissed,
      ...spies,
      ...overrides
    }
  )

  renderApp(
    <>
      <Data />
      <ConfirmDialog />
      <Toasts />
    </>
  )
  return spies
}

// Delete buttons are disabled until the counts arrive, and clicking a disabled
// button is a silent no-op that fails later on the missing dialog.
async function press(name: RegExp | string): Promise<void> {
  const user = userEvent.setup()
  const button = await screen.findByRole('button', { name })
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false))
  await user.click(button)
}

describe('the Data screen', () => {
  it('shows how much there is before you delete it', async () => {
    setup({ books: 47, notes: 12, quotes: 8, reviews: 3 })

    expect(await screen.findByText(/47 books/)).toBeDefined()
    expect(await screen.findByText(/12 ordinary notes/)).toBeDefined()
    expect(await screen.findByText(/8 saved and imported quotes/)).toBeDefined()
    expect(await screen.findByText(/3 book reviews/)).toBeDefined()
  })

  it('deletes nothing until the confirmation is accepted', async () => {
    const spies = setup({ books: 3 })

    await press('Delete books')
    await screen.findByRole('button', { name: 'Cancel' })
    expect(spies.deleteAllBooks).not.toHaveBeenCalled()

    await press('Cancel')
    expect(spies.deleteAllBooks).not.toHaveBeenCalled()
  })

  it('deletes the books once confirmed', async () => {
    const spies = setup({ books: 3 })

    await press('Delete books')
    await press(/^Delete books$/)

    await waitFor(() => expect(spies.deleteAllBooks).toHaveBeenCalled())
  })

  it('names the number in the confirmation', async () => {
    setup({ books: 47 })

    await press('Delete books')

    expect(await screen.findByText('Delete all 47 books?')).toBeDefined()
  })

  it('says that free-floating notes survive a book delete', async () => {
    setup({ books: 2 })

    await press('Delete books')

    // The heading is what settles on mount; the sentence shares a description
    // node with two others, so a text query will not match it alone.
    await screen.findByText('Delete all 2 books?')
    expect(document.body.textContent).toContain('Standalone notes stay')
  })

  it('deletes everything once confirmed', async () => {
    const spies = setup({ books: 1 })

    await press('Delete everything')
    await press(/^Delete everything$/)

    await waitFor(() => expect(spies.deleteEverything).toHaveBeenCalled())
  })

  it('deletes quotes without using the ordinary-note action', async () => {
    const spies = setup({ quotes: 3, notes: 2 })

    await press('Delete quotes')
    await press(/^Delete quotes$/)

    await waitFor(() => expect(spies.deleteAllQuotes).toHaveBeenCalled())
    expect(spies.deleteAllThoughts).not.toHaveBeenCalled()
  })

  it('clears only the recommendation cache', async () => {
    const spies = setup({ candidates: 15, dismissed: 2 })

    await press('Clear cache')
    await press(/^Clear cache$/)

    await waitFor(() => expect(spies.clearRecommendationCache).toHaveBeenCalled())
    expect(spies.deleteEverything).not.toHaveBeenCalled()
  })

  it('disables a delete with nothing behind it', async () => {
    setup({ books: 0, notes: 4 })

    const button = await screen.findByRole('button', { name: 'Delete books' })
    expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('backs up, naming where it went and what went with it', async () => {
    const spies = setup()

    await press('Export library')

    await waitFor(() => expect(spies.exportBackup).toHaveBeenCalled())
    expect(await screen.findByText(/2 books and 5 notes/)).toBeDefined()
    expect(await screen.findByText(/3 Markdown files, to C:\/backup/)).toBeDefined()
  })

  // A cancelled picker returns null, which is not a failure.
  it('says nothing when the backup picker is cancelled', async () => {
    const cancelled = vi.fn(async () => null)
    setup({}, [], { exportBackup: cancelled })

    await press('Export library')

    await waitFor(() => expect(cancelled).toHaveBeenCalled())
    expect(screen.queryByText(/Exported/)).toBeNull()
  })

  it('asks before restoring, since it replaces the whole library', async () => {
    const spies = setup()

    await press('Import')

    expect(await screen.findByText('Import a library?')).toBeDefined()
    expect(spies.restoreBackup).not.toHaveBeenCalled()
  })

  it('restores nothing when the confirmation is refused', async () => {
    const spies = setup()

    await press('Import')
    await press('Cancel')

    expect(spies.restoreBackup).not.toHaveBeenCalled()
  })

  it('restores once the confirmation is accepted', async () => {
    const spies = setup()

    await press('Import')
    await press('Choose an export')

    await waitFor(() => expect(spies.restoreBackup).toHaveBeenCalled())
  })

  it('keeps emergency recovery out of Data', () => {
    setup()
    expect(screen.queryByRole('button', { name: 'Recover library' })).toBeNull()
  })
})

describe('the Not for me list', () => {
  const refused: DismissedBook[] = [
    { olid: 'OL1W', title: 'Os Maias', author: 'Eça de Queiroz', at: 1_700_000_000 }
  ]

  it('names the books that were turned down', async () => {
    setup({}, refused)

    expect(await screen.findByText('Os Maias')).toBeDefined()
  })

  it('falls back to the identifier when the name was never recorded', async () => {
    setup({}, [{ olid: 'OL9W', title: null, author: null, at: 1_700_000_000 }])

    expect(await screen.findByText(/OL9W/)).toBeDefined()
  })

  it('puts a book back without a confirmation, since nothing is lost', async () => {
    const spies = setup({}, refused)

    await press('Restore')

    await waitFor(() => expect(spies.restoreDismissed).toHaveBeenCalledWith('OL1W'))
  })

  it('says so when nothing has been turned down', async () => {
    setup({}, [])

    expect(await screen.findByText(/Nothing turned down yet/)).toBeDefined()
  })
})

function metadataCounts(books: number): DataCounts {
  return { books, notes: 0, quotes: 0, reviews: 0, candidates: 0, dismissed: 0 }
}

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
      {},
      {
        dataCounts: async () => metadataCounts(3),
        listDismissed: async () => [],
        refreshAllMetadata,
        cancelMetadataRefresh
      }
    )
    renderApp(
      <>
        <Data />
        <ConfirmDialog />
      </>
    )
    const user = userEvent.setup()

    await press('Refresh all metadata')
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
      {},
      {
        dataCounts: async () => metadataCounts(1),
        listDismissed: async () => [],
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
        <Data />
        <ConfirmDialog />
      </>
    )
    const user = userEvent.setup()

    await press('Refresh all metadata')
    await user.click(await screen.findByRole('button', { name: 'Refresh all' }))

    expect(await screen.findByText(/0 books refreshed. 1 could not be matched/)).toBeTruthy()
    await user.click(screen.getByText('Books needing attention (1)'))
    expect(document.body.textContent).toContain('Open Library returned no result for this book.')

    await user.click(screen.getByRole('button', { name: 'Retry failed books' }))
    await waitFor(() => expect(retryMetadataRefresh).toHaveBeenCalledWith([1]))
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Metadata refresh summary' })).toBeNull()
    )
  })
})
