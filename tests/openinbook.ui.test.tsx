import type { BookFile } from '@shared/api'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import OpenInBook from '../src/renderer/src/components/OpenInBook'
import { useView } from '../src/renderer/src/lib/view'
import { installBridge, makeBook, makeNote, renderApp } from './helpers/render'

const book = makeBook({ id: 1, title: 'The Glass Orchard' })
const attached: BookFile[] = [{ bookId: 1, fileName: 'orchard.epub', size: 1000, addedAt: 0 }]
const CFI = 'epubcfi(/6/4!/4/2,/1:4,/1:31)'

function Where(): ReactNode {
  const { view } = useView()
  return <p data-testid="where">{JSON.stringify(view)}</p>
}

describe('opening a note at its place in the book', () => {
  it('opens the reader at the passage the quote came from', async () => {
    const quote = makeNote({ id: 5, bookId: 1, kind: 'highlight', location: CFI })
    installBridge({ books: [book], notes: [quote] }, { listBookFiles: async () => attached })
    renderApp(
      <>
        <OpenInBook note={quote} />
        <Where />
      </>
    )

    await userEvent.click(await screen.findByRole('button', { name: 'Open in book' }))

    expect(JSON.parse(screen.getByTestId('where').textContent!)).toEqual({
      kind: 'reader',
      bookId: 1,
      at: CFI
    })
  })

  // Each case renders beside one that qualifies, so the check runs after the files have loaded.
  it('is offered only for reader notes on books that still have an EPUB', async () => {
    const other = makeBook({ id: 2, title: 'Salt and Cinder' })
    const reachable = makeNote({ id: 5, bookId: 1, kind: 'highlight', location: CFI })
    const typed = makeNote({ id: 6, bookId: 1, location: null })
    const noFile = makeNote({ id: 7, bookId: 2, kind: 'highlight', location: CFI })
    installBridge(
      { books: [book, other], notes: [reachable, typed, noFile] },
      { listBookFiles: async () => attached }
    )
    renderApp(
      <>
        <OpenInBook note={reachable} />
        <OpenInBook note={typed} />
        <OpenInBook note={noFile} />
      </>
    )

    await screen.findByRole('button', { name: 'Open in book' })
    expect(screen.getAllByRole('button', { name: 'Open in book' })).toHaveLength(1)
  })
})
