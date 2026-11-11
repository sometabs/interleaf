import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import Stats from '../src/renderer/src/components/Stats'
import { findPicker, openPicker, pickOption } from './helpers/filterPicker'
import { installBridge, makeBook, makeNote, renderApp } from './helpers/render'

describe('Stats', () => {
  it('shows all-time totals and yearly completions, then switches back to months', async () => {
    const year = new Date().getFullYear()
    installBridge({
      books: [
        makeBook({
          id: 1,
          status: 'read',
          pageCount: 100,
          finishedAt: new Date(year, 0, 12, 12).getTime() / 1000
        }),
        makeBook({
          id: 2,
          status: 'read',
          pageCount: 200,
          finishedAt: new Date(year - 1, 5, 12, 12).getTime() / 1000
        }),
        makeBook({
          id: 3,
          status: 'read',
          pageCount: null,
          finishedAt: new Date(year - 1, 5, 15, 12).getTime() / 1000
        }),
        makeBook({ id: 4, status: 'read', pageCount: 300, finishedAt: null }),
        makeBook({ id: 5, status: 'reading', pageCount: 500 })
      ]
    })
    renderApp(<Stats />)
    const user = userEvent.setup()
    await pickOption(user, 'Statistics year', 'All time')

    const section = screen.getByRole('heading', { name: 'Reading by year' }).closest('section')!
    expect(within(section).getByText('Books finished by year')).toBeDefined()
    expect(within(section).getByLabelText(`${year - 1}: 2 books`)).toBeDefined()
    expect(within(section).getByLabelText(`${year}: 1 book`)).toBeDefined()
    expect(within(section).getByText('600')).toBeDefined()
    expect(within(section).getByText('4')).toBeDefined()
    expect(within(section).getByText('Based on 3 of 4 books with page counts')).toBeDefined()
    expect(
      within(section).getByText(
        'Books without a finished date are included in totals, but not the chart.'
      )
    ).toBeDefined()
    expect(screen.queryByLabelText('Jan: 1 book')).toBeNull()

    await pickOption(user, 'Statistics year', String(year))
    expect(within(section).getByText('Books finished by month')).toBeDefined()
    expect(within(section).getByLabelText('Jan: 1 book')).toBeDefined()
    expect(within(section).getByText('100')).toBeDefined()
    expect(
      within(section).queryByText(
        'Books without a finished date are included in totals, but not the chart.'
      )
    ).toBeNull()
  })

  it('switches yearly totals and monthly counts without changing all-time totals', async () => {
    const currentYear = new Date().getFullYear()
    installBridge({
      books: [
        makeBook({
          id: 1,
          status: 'read',
          pageCount: 100,
          finishedAt: new Date(currentYear, 0, 12, 12).getTime() / 1000
        }),
        makeBook({
          id: 2,
          status: 'read',
          pageCount: 200,
          finishedAt: new Date(currentYear - 1, 5, 12, 12).getTime() / 1000
        }),
        makeBook({
          id: 3,
          status: 'read',
          pageCount: 300,
          finishedAt: new Date(currentYear - 1, 5, 15, 12).getTime() / 1000
        })
      ]
    })
    renderApp(<Stats />)
    const user = userEvent.setup()
    const selector = await findPicker('Statistics year')
    expect(selector.textContent).toBe(String(currentYear))
    expect(screen.getByLabelText('Jan: 1 book')).toBeDefined()
    const allTime = screen.getByRole('heading', { name: 'All time' }).closest('section')!
    const allTimeBefore = allTime.textContent

    const panel = await openPicker(user, 'Statistics year')
    expect(document.activeElement).toBe(
      within(panel).getByRole('button', { name: String(currentYear) })
    )
    await user.keyboard('{ArrowDown}{Enter}')

    expect(screen.getByLabelText('Jan: 0 books')).toBeDefined()
    expect(screen.getByLabelText('Jun: 2 books')).toBeDefined()
    const yearly = screen.getByRole('heading', { name: 'Reading by year' }).closest('section')!
    expect(within(yearly).getByText('500')).toBeDefined()
    const finished = within(yearly).getByText('Books finished').parentElement!
    expect(within(finished).getByText('2')).toBeDefined()
    expect(allTime.textContent).toBe(allTimeBefore)

    await pickOption(user, 'Statistics year', String(currentYear))
    expect(screen.getByLabelText('Jan: 1 book')).toBeDefined()
    expect(within(yearly).getByText('100')).toBeDefined()
  })

  it('keeps previous years available when a new year starts with no completed books', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2027, 0, 1, 12))
    try {
      installBridge({
        books: [
          makeBook({ status: 'read', finishedAt: new Date(2026, 11, 12, 12).getTime() / 1000 })
        ]
      })
      renderApp(<Stats />)
      const user = userEvent.setup()
      expect((await findPicker('Statistics year')).textContent).toBe('2027')
      const panel = within(await openPicker(user, 'Statistics year'))
      expect(panel.getAllByRole('button').map((option) => option.textContent)).toEqual([
        'All time',
        '2027',
        '2026'
      ])
      expect(
        screen.getByText('No books with completion dates for the selected year.')
      ).toBeDefined()

      await user.click(panel.getByRole('button', { name: '2026' }))

      expect(screen.getByLabelText('Dec: 1 book')).toBeDefined()
      expect(screen.queryByText('No books with completion dates for the selected year.')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('offers the current year for an empty library', async () => {
    installBridge()
    renderApp(<Stats />)
    const user = userEvent.setup()
    expect((await findPicker('Statistics year')).textContent).toBe(String(new Date().getFullYear()))
    const panel = within(await openPicker(user, 'Statistics year'))
    expect(panel.getAllByRole('button')).toHaveLength(2)
    await user.click(panel.getByRole('button', { name: 'All time' }))
    expect(screen.getByText('No books with completion dates yet.')).toBeDefined()
    expect(
      screen.queryByText('Books without a finished date are included in totals, but not the chart.')
    ).toBeNull()
  })

  it('shows local reading and journal information', async () => {
    const year = new Date().getFullYear()
    const finishedAt = Math.floor(new Date(year, 0, 12, 12).getTime() / 1000)
    installBridge({
      books: [
        makeBook({
          id: 1,
          status: 'read',
          pageCount: 320,
          rating: 5,
          finishedAt
        }),
        makeBook({ id: 2, title: 'A Wizard of Earthsea', status: 'read', pageCount: null })
      ],
      notes: [makeNote({ kind: 'review' }), makeNote({ id: 11, kind: 'highlight' })]
    })

    renderApp(<Stats />)

    expect(await screen.findByRole('heading', { name: 'Stats' })).toBeDefined()
    expect(screen.getByText('Based on 1 of 2 books with page counts')).toBeDefined()
    expect(screen.getByLabelText('Jan: 1 book')).toBeDefined()
    expect(screen.getByText('Ursula K. Le Guin')).toBeDefined()
    expect(screen.getByText('Reviews')).toBeDefined()
    expect(screen.getByText('Quotes')).toBeDefined()
  })
})
