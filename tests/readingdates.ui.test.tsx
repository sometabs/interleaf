import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import BookDetail from '../src/renderer/src/components/BookDetail'
import { fromDateInput, toDateInput } from '../src/renderer/src/lib/dates'
import { useBook } from '../src/renderer/src/lib/queries'
import { statusPatch } from '../src/renderer/src/lib/status'
import { installBridge, makeBook, renderApp, type FakeBridge } from './helpers/render'

function BookRoute({ id }: { id: number }): ReactNode {
  const book = useBook(id)
  return book ? <BookDetail key={id} book={book} /> : null
}

function field(label: string): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement
}

async function type(label: string, value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(field(label), { target: { value } })
  })
}

async function open(bridge: FakeBridge): Promise<void> {
  renderApp(<BookRoute id={1} />, { kind: 'book', id: 1 })
  await waitFor(() => expect(field('Started reading')).toBeDefined())
  void bridge
}

describe('changing status', () => {
  it('changes status and nothing else', () => {
    expect(statusPatch('read')).toEqual({ status: 'read' })
    expect(statusPatch('reading')).toEqual({ status: 'reading' })
  })

  it('leaves the dates alone when a book is marked read', async () => {
    const bridge = installBridge({ books: [makeBook({ id: 1, status: 'want' })] })
    await open(bridge)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Read' }))
    })

    await waitFor(() => expect(bridge.books[0].status).toBe('read'))
    expect(bridge.books[0].finishedAt).toBeNull()
    expect(bridge.books[0].startedAt).toBeNull()
  })
})

describe('typing the reading dates', () => {
  it('starts empty on a newly added book', async () => {
    const bridge = installBridge({
      books: [makeBook({ id: 1, startedAt: null, finishedAt: null })]
    })
    await open(bridge)

    expect(field('Started reading').value).toBe('')
    expect(field('Finished reading').value).toBe('')
  })

  it('saves what was typed', async () => {
    const bridge = installBridge({ books: [makeBook({ id: 1 })] })
    await open(bridge)

    await type('Started reading', '2026-07-28')

    await waitFor(() => expect(bridge.books[0].startedAt).not.toBeNull())
    expect(toDateInput(bridge.books[0].startedAt)).toBe('2026-07-28')
  })

  it('clears a date when the field is emptied', async () => {
    const bridge = installBridge({
      books: [makeBook({ id: 1, finishedAt: fromDateInput('2026-07-28') })]
    })
    await open(bridge)
    expect(field('Finished reading').value).toBe('2026-07-28')

    await type('Finished reading', '')

    await waitFor(() => expect(bridge.books[0].finishedAt).toBeNull())
  })

  it('shows a date already on the book', async () => {
    const bridge = installBridge({
      books: [
        makeBook({
          id: 1,
          startedAt: fromDateInput('2026-01-02'),
          finishedAt: fromDateInput('2026-03-04')
        })
      ]
    })
    await open(bridge)

    expect(field('Started reading').value).toBe('2026-01-02')
    expect(field('Finished reading').value).toBe('2026-03-04')
  })

  it('says so when the pair reads backwards', async () => {
    const bridge = installBridge({
      books: [
        makeBook({
          id: 1,
          startedAt: fromDateInput('2026-08-08'),
          finishedAt: fromDateInput('2026-07-28')
        })
      ]
    })
    await open(bridge)

    expect(screen.getByText('Finished before started.')).toBeDefined()
  })

  it('says nothing when they read the right way round', async () => {
    const bridge = installBridge({
      books: [
        makeBook({
          id: 1,
          startedAt: fromDateInput('2026-07-28'),
          finishedAt: fromDateInput('2026-08-08')
        })
      ]
    })
    await open(bridge)

    expect(screen.queryByText('Finished before started.')).toBeNull()
  })

  it('says nothing when only one of them is filled', async () => {
    const bridge = installBridge({
      books: [makeBook({ id: 1, startedAt: fromDateInput('2026-08-08'), finishedAt: null })]
    })
    await open(bridge)

    expect(screen.queryByText('Finished before started.')).toBeNull()
  })
})

// `new Date('2026-08-09')` is UTC midnight, which west of Greenwich is the 8th,
// so both directions go through the local calendar.
describe('the date conversion itself', () => {
  it('round-trips every date it is given', () => {
    for (const value of ['2026-01-01', '2026-07-28', '2026-08-09', '1999-12-31', '2026-02-28']) {
      expect(toDateInput(fromDateInput(value))).toBe(value)
    }
  })

  it('treats an empty or malformed value as no date', () => {
    expect(fromDateInput('')).toBeNull()
    expect(fromDateInput('   ')).toBeNull()
    expect(fromDateInput('not a date')).toBeNull()
    expect(fromDateInput('2026-13')).toBeNull()
  })

  it('renders no date as an empty field', () => {
    expect(toDateInput(null)).toBe('')
  })

  it('lands on local midnight, not UTC midnight', () => {
    const seconds = fromDateInput('2026-08-09')
    expect(seconds).not.toBeNull()
    const date = new Date((seconds ?? 0) * 1000)
    expect(date.getDate()).toBe(9)
    expect(date.getHours()).toBe(0)
  })
})
