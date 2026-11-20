import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import BookDetail from '../src/renderer/src/components/BookDetail'
import { useBook } from '../src/renderer/src/lib/queries'
import { installBridge, makeBook, makeNote, renderApp } from './helpers/render'

function BookRoute(): ReactNode {
  const book = useBook(1)
  return book ? <BookDetail book={book} /> : null
}

const FOLD = { name: 'What did you make of The Dispossessed?' }

describe('the review on a book page', () => {
  it('starts as one line when there is no review, and opens ready to type', async () => {
    const user = userEvent.setup()
    installBridge({ books: [makeBook({ id: 1, title: 'The Dispossessed' })] })
    renderApp(<BookRoute />, { kind: 'book', id: 1 })

    await user.click(await screen.findByRole('button', FOLD))

    const editor = await screen.findByTestId('editor')
    await waitFor(() => expect(editor.contains(document.activeElement)).toBe(true))
  })

  it('folds back when left empty', async () => {
    const user = userEvent.setup()
    installBridge({ books: [makeBook({ id: 1, title: 'The Dispossessed' })] })
    renderApp(<BookRoute />, { kind: 'book', id: 1 })
    await user.click(await screen.findByRole('button', FOLD))
    await screen.findByTestId('editor')

    await user.click(screen.getByRole('button', { name: 'Reading' }))

    expect(await screen.findByRole('button', FOLD)).toBeDefined()
    expect(screen.queryByTestId('editor')).toBeNull()
  })

  it('stays open once something is written', async () => {
    const user = userEvent.setup()
    installBridge({ books: [makeBook({ id: 1, title: 'The Dispossessed' })] })
    renderApp(<BookRoute />, { kind: 'book', id: 1 })
    await user.click(await screen.findByRole('button', FOLD))
    const editor = await screen.findByTestId('editor')
    const dom = editor.querySelector<HTMLElement>('.note-prose')!

    await act(async () => {
      dom.innerHTML = '<p>Walls on both sides.</p>'
      dom.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await user.click(screen.getByRole('button', { name: 'Reading' }))

    expect(screen.getByTestId('editor')).toBe(editor)
  })

  it('opens straight away for a book that already has a review', async () => {
    installBridge({
      books: [makeBook({ id: 1, title: 'The Dispossessed' })],
      notes: [makeNote({ id: 9, bookId: 1, kind: 'review', bodyMd: 'Walls on both sides.' })]
    })
    renderApp(<BookRoute />, { kind: 'book', id: 1 })

    expect(await screen.findByTestId('editor')).toBeDefined()
    expect(screen.queryByRole('button', FOLD)).toBeNull()
  })
})
