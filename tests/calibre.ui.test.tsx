import type { CalibreImportPlan } from '@shared/api'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from '../src/renderer/src/App'
import CalibreImport from '../src/renderer/src/components/CalibreImport'
import { resetMessages } from '../src/renderer/src/lib/feedback'
import { installBridge, makeBook, renderApp } from './helpers/render'

afterEach(() => resetMessages())

const SHELLEY = makeBook({ id: 1, title: 'Frankenstein', author: 'Mary Shelley' })
const MEDITATIONS = makeBook({ id: 2, title: 'Meditations', author: 'Marcus Aurelius' })

function plan(overrides: Partial<CalibreImportPlan['books'][number]> = {}): CalibreImportPlan {
  return {
    filePath: 'C:/exports/annotations.json',
    books: [
      {
        calibreId: 42,
        bookId: null,
        newHighlights: 2,
        knownHighlights: 0,
        samples: ['Nothing is so painful to the human mind as a great and sudden change.'],
        ...overrides
      }
    ]
  }
}

function bridge(overrides = {}): Record<string, ReturnType<typeof vi.fn>> {
  const spies = {
    readCalibreExport: vi.fn(async () => plan()),
    importCalibreHighlights: vi.fn(async () => ({ imported: 2, skipped: 0, books: 1 }))
  }
  const merged = { ...spies, ...overrides }
  installBridge({ books: [SHELLEY, MEDITATIONS] }, merged)
  return merged
}

describe('starting an import from Data', () => {
  it('asks which book an unmatched Calibre book is', async () => {
    bridge()
    renderApp(<App />, { kind: 'data' })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Choose file' }))

    expect(await screen.findByRole('heading', { name: 'Import highlights' })).toBeTruthy()
  })

  it('imports without asking when every book was matched before', async () => {
    const spies = bridge({ readCalibreExport: vi.fn(async () => plan({ bookId: 1 })) })
    renderApp(<App />, { kind: 'data' })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Choose file' }))

    await waitFor(() =>
      expect(spies.importCalibreHighlights).toHaveBeenCalledWith('C:/exports/annotations.json', [
        { calibreId: 42, bookId: 1 }
      ])
    )
    expect(await screen.findByText('Imported 2 highlights into 1 book')).toBeTruthy()
    // Nothing to decide, so the matching screen never appears.
    expect(screen.queryByRole('heading', { name: 'Import highlights' })).toBeNull()
  })

  it('keeps the Calibre steps out of the way until they are asked for', async () => {
    bridge()
    renderApp(<App />, { kind: 'data' })
    const user = userEvent.setup()

    const steps = await screen.findByText('Where do I get that file?')
    expect(steps.closest('details')?.open).toBe(false)

    await user.click(steps)

    expect(steps.closest('details')?.open).toBe(true)
    expect(screen.getByText(/Browse annotations/)).toBeTruthy()
  })

  it('does nothing when the file picker is cancelled', async () => {
    const spies = bridge({ readCalibreExport: vi.fn(async () => null) })
    renderApp(<App />, { kind: 'data' })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Choose file' }))

    await waitFor(() => expect(spies.readCalibreExport).toHaveBeenCalled())
    expect(spies.importCalibreHighlights).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: 'Import highlights' })).toBeNull()
  })

  it('says so when the file holds no highlights', async () => {
    bridge({ readCalibreExport: vi.fn(async () => ({ filePath: 'C:/empty.json', books: [] })) })
    renderApp(<App />, { kind: 'data' })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Choose file' }))

    expect(await screen.findByText('No highlights in that file')).toBeTruthy()
  })
})

describe('the matching screen', () => {
  it('shows the passages, since the export names no book', async () => {
    bridge()
    renderApp(<CalibreImport plan={plan()} />, { kind: 'import', plan: plan() })

    expect(await screen.findByText(/a great and sudden change/)).toBeTruthy()
    expect(screen.getByText('Calibre book 42')).toBeTruthy()
    expect(screen.getByText('2 new')).toBeTruthy()
  })

  it('imports nothing until a book is chosen', async () => {
    bridge()
    renderApp(<CalibreImport plan={plan()} />, { kind: 'import', plan: plan() })

    expect(
      (await screen.findByRole('button', { name: 'Import highlights' })).hasAttribute('disabled')
    ).toBe(true)
  })

  it('sends the book you chose', async () => {
    const spies = bridge()
    renderApp(<CalibreImport plan={plan()} />, { kind: 'import', plan: plan() })
    const user = userEvent.setup()

    await screen.findByRole('option', { name: /Meditations/ })
    await user.selectOptions(
      screen.getByLabelText('Book for Calibre book 42'),
      MEDITATIONS.id.toString()
    )
    await user.click(screen.getByRole('button', { name: 'Import highlights' }))

    await waitFor(() =>
      expect(spies.importCalibreHighlights).toHaveBeenCalledWith('C:/exports/annotations.json', [
        { calibreId: 42, bookId: 2 }
      ])
    )
  })

  it('leaves a book you skipped out of the import', async () => {
    const spies = bridge()
    const both: CalibreImportPlan = {
      filePath: 'C:/exports/annotations.json',
      books: [
        ...plan().books,
        {
          calibreId: 21,
          bookId: null,
          newHighlights: 1,
          knownHighlights: 0,
          samples: ['Very little is needed to make a happy life.']
        }
      ]
    }
    renderApp(<CalibreImport plan={both} />, { kind: 'import', plan: both })
    const user = userEvent.setup()

    await screen.findAllByRole('option', { name: /Shelley/ })
    await user.selectOptions(screen.getByLabelText('Book for Calibre book 42'), '1')
    await user.click(screen.getByRole('button', { name: 'Import highlights' }))

    await waitFor(() =>
      expect(spies.importCalibreHighlights).toHaveBeenCalledWith('C:/exports/annotations.json', [
        { calibreId: 42, bookId: 1 }
      ])
    )
  })

  it('starts from the match made on an earlier import', async () => {
    bridge()
    const known = plan({ bookId: 2, knownHighlights: 3 })
    renderApp(<CalibreImport plan={known} />, { kind: 'import', plan: known })

    await screen.findByRole('option', { name: /Meditations/ })
    const select = screen.getByLabelText('Book for Calibre book 42') as HTMLSelectElement
    expect(select.value).toBe('2')
    expect(screen.getByText('2 new, 3 already imported')).toBeTruthy()
  })
})
