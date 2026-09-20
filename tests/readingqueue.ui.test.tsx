import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import ReadingQueue from '../src/renderer/src/components/ReadingQueue'
import { installBridge, makeBook, renderApp } from './helpers/render'

function queueBooks(): ReturnType<typeof makeBook>[] {
  return [
    makeBook({ id: 1, title: 'Dune', status: 'want', priorityPosition: 1 }),
    makeBook({ id: 2, title: 'Solaris', status: 'want', priorityPosition: 2 }),
    makeBook({ id: 3, title: 'The Left Hand of Darkness', status: 'want', priorityPosition: 3 }),
    makeBook({ id: 4, title: 'Already Read', status: 'read', priorityPosition: null })
  ]
}

function titlesInQueue(): string[] {
  return within(screen.getByLabelText('Want-to-read order'))
    .getAllByRole('article')
    .map((row) => row.textContent ?? '')
}

describe('Reading queue', () => {
  it('shows every Want to read book in one ordered list', async () => {
    installBridge({ books: queueBooks() })
    renderApp(<ReadingQueue />, { kind: 'queue' })

    const queue = await screen.findByLabelText('Want-to-read order')
    expect(within(queue).getByText('Dune')).toBeTruthy()
    expect(within(queue).getByText('Solaris')).toBeTruthy()
    expect(within(queue).getByText('The Left Hand of Darkness')).toBeTruthy()
    expect(screen.queryByText('Already Read')).toBeNull()
    expect(screen.queryByRole('button', { name: /Add to queue|Remove/ })).toBeNull()
  })

  it('reorders the list with its arrow controls', async () => {
    const bridge = installBridge({ books: queueBooks() })
    renderApp(<ReadingQueue />, { kind: 'queue' })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Move Dune later' }))

    await waitFor(() => {
      expect(bridge.books.find((book) => book.id === 1)?.priorityPosition).toBe(2)
      expect(bridge.books.find((book) => book.id === 2)?.priorityPosition).toBe(1)
    })
  })

  it('shows an arrow reorder after a drag has already changed the order', async () => {
    const bridge = installBridge({ books: queueBooks() })
    renderApp(<ReadingQueue />, { kind: 'queue' })
    const user = userEvent.setup()

    const rows = within(await screen.findByLabelText('Want-to-read order')).getAllByRole('article')
    const transferred = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: (type: string, value: string) => transferred.set(type, value),
      getData: (type: string) => transferred.get(type) ?? ''
    }

    fireEvent.dragStart(rows[0], { dataTransfer })
    fireEvent.dragOver(rows[2], { dataTransfer, clientY: 1 })
    fireEvent.drop(rows[2], { dataTransfer, clientY: 1 })
    fireEvent.dragEnd(rows[0], { dataTransfer })

    await waitFor(() => {
      expect(bridge.books.find((book) => book.id === 1)?.priorityPosition).toBe(2)
      expect(titlesInQueue()).toEqual([
        expect.stringContaining('Solaris'),
        expect.stringContaining('Dune'),
        expect.stringContaining('The Left Hand of Darkness')
      ])
    })

    await user.click(screen.getByRole('button', { name: 'Move Solaris later' }))

    await waitFor(() => {
      expect(bridge.books.find((book) => book.id === 2)?.priorityPosition).toBe(2)
      expect(titlesInQueue()).toEqual([
        expect.stringContaining('Dune'),
        expect.stringContaining('Solaris'),
        expect.stringContaining('The Left Hand of Darkness')
      ])
    })
  })

  it('explains an empty Want to read list', async () => {
    installBridge({ books: [makeBook({ status: 'read', priorityPosition: null })] })
    renderApp(<ReadingQueue />, { kind: 'queue' })

    expect(await screen.findByText('Your Want to read list is empty.')).toBeTruthy()
  })
})
