import type { AttachEpubResult, BookFile, EpubCandidate } from '@shared/api'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import BookDetail from '../src/renderer/src/components/BookDetail'
import ConfirmDialog from '../src/renderer/src/components/ConfirmDialog'
import EpubActions from '../src/renderer/src/components/EpubActions'
import EpubDrop from '../src/renderer/src/components/EpubDrop'
import Toasts from '../src/renderer/src/components/Toasts'
import { resetConfirm } from '../src/renderer/src/lib/confirm'
import { resetMessages } from '../src/renderer/src/lib/feedback'
import { installBridge, makeBook, renderApp } from './helpers/render'

afterEach(() => {
  resetConfirm()
  resetMessages()
})

const orchard = makeBook({ id: 1, title: 'The Glass Orchard', author: 'Mira Halden' })
const other = makeBook({ id: 2, title: 'Salt and Cinder', author: 'Ines Varga' })

function candidate(overrides: Partial<EpubCandidate> = {}): EpubCandidate {
  return {
    path: 'C:/books/orchard.epub',
    fileName: 'orchard.epub',
    title: 'The Glass Orchard',
    author: 'Mira Halden',
    isbn: null,
    bookId: null,
    ...overrides
  }
}

const file = (bookId: number): BookFile => ({
  bookId,
  fileName: 'orchard.epub',
  size: 1000,
  addedAt: 0
})

describe('the EPUB buttons on a book page', () => {
  it('attaches a chosen file', async () => {
    const attachEpub = vi.fn(async (): Promise<AttachEpubResult> => ({ kind: 'attached' }))
    installBridge(
      { books: [orchard] },
      { chooseEpub: async () => candidate(), attachEpub, listBookFiles: async () => [] }
    )
    renderApp(
      <>
        <EpubActions book={orchard} />
        <Toasts />
      </>
    )

    await userEvent.click(await screen.findByRole('button', { name: 'Attach EPUB' }))

    expect(attachEpub).toHaveBeenCalledWith(1, 'C:/books/orchard.epub', false)
    expect(await screen.findByText('EPUB attached to “The Glass Orchard”.')).toBeTruthy()
  })

  it('asks before replacing a different file, from the book menu', async () => {
    const attachEpub = vi.fn(
      async (_bookId: number, _path: string, replace: boolean): Promise<AttachEpubResult> =>
        replace ? { kind: 'attached' } : { kind: 'replace-needed' }
    )
    installBridge(
      { books: [orchard] },
      {
        chooseEpub: async () => candidate(),
        attachEpub,
        listBookFiles: async () => [file(1)],
        getReadingPosition: async () => ({ cfi: 'epubcfi(/6/4)', fraction: 0.34 })
      }
    )
    renderApp(
      <>
        <BookDetail book={orchard} />
        <ConfirmDialog />
      </>,
      { kind: 'book', id: 1 }
    )

    expect(await screen.findByRole('button', { name: 'Continue reading · 34%' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'More book actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Replace EPUB' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Replace' }))

    await waitFor(() =>
      expect(attachEpub).toHaveBeenLastCalledWith(1, 'C:/books/orchard.epub', true)
    )
  })

  it('says so when the file belongs to another book, without attaching', async () => {
    const attachEpub = vi.fn()
    installBridge(
      { books: [orchard, other] },
      {
        chooseEpub: async () => candidate({ bookId: 2 }),
        attachEpub,
        listBookFiles: async () => []
      }
    )
    renderApp(
      <>
        <EpubActions book={orchard} />
        <Toasts />
      </>
    )

    await userEvent.click(await screen.findByRole('button', { name: 'Attach EPUB' }))

    expect(
      await screen.findByText('This EPUB is already attached to “Salt and Cinder”.')
    ).toBeTruthy()
    expect(attachEpub).not.toHaveBeenCalled()
  })
})

describe('dropping an EPUB on the window', () => {
  function drop(name = 'orchard.epub'): void {
    const dropped = new File(['x'], name)
    const event = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', {
      value: { types: ['Files'], files: [dropped] }
    })
    act(() => {
      fireEvent(window, event)
    })
  }

  it('offers the clear match first and attaches to it', async () => {
    const attachEpub = vi.fn(async (): Promise<AttachEpubResult> => ({ kind: 'attached' }))
    installBridge({ books: [orchard, other] }, {
      inspectEpub: async () => candidate({ title: 'Glass Orchard (Deluxe Edition)' }),
      attachEpub,
      pathForFile: () => 'C:/books/orchard.epub'
    } as never)
    renderApp(<EpubDrop />)

    drop()
    await userEvent.click(await screen.findByRole('button', { name: 'Attach to this book' }))

    expect(attachEpub).toHaveBeenCalledWith(1, 'C:/books/orchard.epub', false)
  })

  it('lists the whole library when nothing matches', async () => {
    const attachEpub = vi.fn(async (): Promise<AttachEpubResult> => ({ kind: 'attached' }))
    installBridge({ books: [orchard, other] }, {
      inspectEpub: async () => candidate({ title: 'Untitled', author: null }),
      attachEpub,
      pathForFile: () => 'C:/books/untitled.epub'
    } as never)
    renderApp(<EpubDrop />)

    drop('untitled.epub')
    expect(await screen.findByText('Which book is this EPUB?')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Attach to this book' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Salt and Cinder/ }))

    expect(attachEpub).toHaveBeenCalledWith(2, 'C:/books/orchard.epub', false)
  })

  it('opens the book that already holds the same file', async () => {
    installBridge({ books: [orchard] }, {
      inspectEpub: async () => candidate({ bookId: 1 }),
      pathForFile: () => 'C:/books/orchard.epub'
    } as never)
    renderApp(
      <>
        <EpubDrop />
        <Toasts />
      </>
    )

    drop()

    expect(await screen.findByText('This EPUB is already in your library.')).toBeTruthy()
    expect(screen.queryByText('Which book is this EPUB?')).toBeNull()
  })

  it('ignores files that are not EPUBs', async () => {
    const inspectEpub = vi.fn()
    installBridge({ books: [orchard] }, { inspectEpub } as never)
    renderApp(
      <>
        <EpubDrop />
        <Toasts />
      </>
    )

    drop('notes.pdf')

    expect(await screen.findByText('Only EPUB files can be dropped here.')).toBeTruthy()
    expect(inspectEpub).not.toHaveBeenCalled()
  })

  it('shows where to drop while a file is dragged over the window', () => {
    installBridge({ books: [orchard] })
    renderApp(<EpubDrop />)
    const dragEvent = (type: string): Event => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files: [] } })
      return event
    }

    act(() => {
      fireEvent(window, dragEvent('dragenter'))
    })
    expect(screen.getByText('Drop to add this EPUB')).toBeTruthy()

    act(() => {
      fireEvent(window, dragEvent('dragleave'))
    })
    expect(screen.queryByText('Drop to add this EPUB')).toBeNull()
  })
})
