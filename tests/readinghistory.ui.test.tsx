import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import App from '../src/renderer/src/App'
import ReadingHistory from '../src/renderer/src/components/ReadingHistory'
import { formatDate } from '../src/renderer/src/lib/dates'
import { installBridge, makeBook, renderApp } from './helpers/render'

function day(year: number, month: number, date: number): number {
  return new Date(year, month - 1, date).getTime() / 1000
}

function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(
    new Date(year, month - 1, 1)
  )
}

describe('Reading history', () => {
  it('groups by finish month and year, sorts by finish date, and puts undated reads last', async () => {
    installBridge({
      books: [
        makeBook({ id: 1, title: 'Undated', status: 'read', updatedAt: day(2026, 12, 1) }),
        makeBook({ id: 2, title: 'Older', status: 'read', finishedAt: day(2026, 10, 2) }),
        makeBook({
          id: 3,
          title: 'Earlier this month',
          status: 'read',
          finishedAt: day(2026, 11, 1)
        }),
        makeBook({ id: 4, title: 'Latest', status: 'read', finishedAt: day(2026, 11, 10) }),
        makeBook({ id: 5, title: 'Last year', status: 'read', finishedAt: day(2025, 11, 30) }),
        makeBook({
          id: 6,
          title: 'Reading again',
          status: 'reading',
          finishedAt: day(2026, 11, 12)
        }),
        makeBook({ id: 7, title: 'Queued', status: 'want' }),
        makeBook({ id: 8, title: 'Set aside', status: 'abandoned' })
      ]
    })
    renderApp(<ReadingHistory />, { kind: 'history' })

    await screen.findByRole('heading', { name: monthLabel(2026, 11) })
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    ).toEqual([monthLabel(2026, 11), monthLabel(2026, 10), monthLabel(2025, 11), 'Date unknown'])
    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)
    ).toEqual(['Latest', 'Earlier this month', 'Older', 'Last year', 'Undated'])
    expect(screen.getByText('5 books finished.')).toBeDefined()
    expect(screen.queryByRole('heading', { name: 'Reading again' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Queued' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Set aside' })).toBeNull()
  })

  it('shows saved ratings, dates and elapsed duration without inventing missing durations', async () => {
    const finishedAt = day(2026, 11, 10)
    installBridge({
      books: [
        makeBook({
          id: 1,
          title: 'A finished book',
          status: 'read',
          rating: 4,
          startedAt: day(2026, 11, 3),
          finishedAt
        }),
        makeBook({ id: 2, title: 'Quick read', status: 'read', startedAt: finishedAt, finishedAt }),
        makeBook({ id: 3, title: 'No start date', status: 'read', finishedAt }),
        makeBook({
          id: 4,
          title: 'Invalid range',
          status: 'read',
          startedAt: day(2026, 11, 20),
          finishedAt
        })
      ]
    })
    renderApp(<ReadingHistory />, { kind: 'history' })

    const row = await screen.findByRole('button', { name: /^A finished book/ })
    expect(within(row).getByRole('img', { name: 'Rated 4 of 5' })).toBeDefined()
    expect(within(row).getByText(`Finished ${formatDate(finishedAt)}`)).toBeDefined()
    expect(within(row).getByText('Read in 7 days')).toBeDefined()
    expect(
      within(screen.getByRole('button', { name: /^Quick read/ })).getByText('Read in a day')
    ).toBeDefined()
    for (const title of ['No start date', 'Invalid range']) {
      const missing = screen.getByRole('button', { name: new RegExp(`^${title}`) })
      expect(within(missing).queryByTitle(/Elapsed calendar days/)).toBeNull()
    }
  })

  it('opens from the sidebar and palette, and returns to history after opening a book', async () => {
    installBridge({
      books: [makeBook({ title: 'Solaris', status: 'read', finishedAt: day(2026, 11, 10) })]
    })
    renderApp(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /^Reading history/ }))
    expect(await screen.findByRole('heading', { name: 'Reading history' })).toBeDefined()
    await user.click(screen.getByRole('button', { name: /^Solaris/ }))
    await user.click(await screen.findByRole('button', { name: '← Reading history' }))
    expect(await screen.findByRole('heading', { name: 'Reading history' })).toBeDefined()

    await user.click(screen.getByRole('button', { name: /^Library/ }))
    await user.click(screen.getByRole('button', { name: 'Search and commands' }))
    await user.type(
      within(screen.getByRole('dialog')).getByRole('combobox'),
      'Go to Reading history'
    )
    await user.click(await screen.findByRole('option', { name: /Go to Reading history/ }))
    expect(await screen.findByRole('heading', { name: 'Reading history' })).toBeDefined()
  })

  it('explains how books enter an empty history', async () => {
    installBridge({ books: [makeBook({ status: 'want' })] })
    renderApp(<ReadingHistory />, { kind: 'history' })

    expect(await screen.findByText('No finished books yet')).toBeDefined()
    expect(screen.getByText('Mark a book as Read to see it here.')).toBeDefined()
  })
})
