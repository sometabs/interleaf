import type { DataCounts, DismissedBook } from '@shared/api'
import { screen, waitFor } from '@testing-library/react'
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
    deleteAllNotes: vi.fn(async () => counts.notes ?? 0),
    deleteEverything: vi.fn(async () => undefined),
    restoreDismissed: vi.fn(async () => undefined),
    exportVault: vi.fn(async () => ({ dir: 'C:/vault', files: 3 })),
    importVault: vi.fn(async () => ({ books: 2, notes: 5 }))
  }

  installBridge(
    {},
    {
      dataCounts: async () => ({
        books: counts.books ?? 0,
        notes: counts.notes ?? 0,
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
    setup({ books: 47, notes: 12 })

    expect(await screen.findByText(/47 books/)).toBeDefined()
    expect(await screen.findByText(/12 notes/)).toBeDefined()
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
    expect(document.body.textContent).toContain('not attached to a book are kept')
  })

  it('deletes everything once confirmed', async () => {
    const spies = setup({ books: 1 })

    await press('Delete everything')
    await press(/^Delete everything$/)

    await waitFor(() => expect(spies.deleteEverything).toHaveBeenCalled())
  })

  it('disables a delete with nothing behind it', async () => {
    setup({ books: 0, notes: 4 })

    const button = await screen.findByRole('button', { name: 'Delete books' })
    expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('exports a vault, naming where it went', async () => {
    const spies = setup()

    await press('Export')

    await waitFor(() => expect(spies.exportVault).toHaveBeenCalled())
    expect(await screen.findByText(/Exported 3 files to C:\/vault/)).toBeDefined()
  })

  // A cancelled picker returns null, which is not a failure.
  it('says nothing when the export picker is cancelled', async () => {
    const cancelled = vi.fn(async () => null)
    setup({}, [], { exportVault: cancelled })

    await press('Export')

    await waitFor(() => expect(cancelled).toHaveBeenCalled())
    expect(screen.queryByText(/Exported/)).toBeNull()
  })

  it('imports a vault back in', async () => {
    const spies = setup()

    await press('Import')

    await waitFor(() => expect(spies.importVault).toHaveBeenCalled())
    expect(await screen.findByText(/Imported 2 books and 5 notes/)).toBeDefined()
  })

  // The importer looks for `books/` and `notes/` inside what was picked, so a
  // wrong folder is otherwise indistinguishable from a failure.
  it('says which folder to pick when it finds nothing', async () => {
    setup({}, [], { importVault: vi.fn(async () => ({ books: 0, notes: 0 })) })

    await press('Import')

    expect(await screen.findByText(/pick the folder that contains/i)).toBeDefined()
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
