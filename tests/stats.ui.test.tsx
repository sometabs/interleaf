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

  it('draws a column for every half step, counting each rating given', async () => {
    installBridge({
      books: [
        makeBook({ id: 1, rating: 5 }),
        makeBook({ id: 2, rating: 4.5 }),
        makeBook({ id: 3, rating: 4.5 })
      ]
    })
    renderApp(<Stats />)

    const section = (await screen.findByRole('heading', { name: 'Ratings' })).closest('section')!
    const columns = [...section.querySelectorAll('[aria-label$=book], [aria-label$=books]')].map(
      (column) => column.getAttribute('aria-label')
    )
    expect(columns).toEqual([
      '1 star: 0 books',
      '1.5 stars: 0 books',
      '2 stars: 0 books',
      '2.5 stars: 0 books',
      '3 stars: 0 books',
      '3.5 stars: 0 books',
      '4 stars: 0 books',
      '4.5 stars: 2 books',
      '5 stars: 1 book'
    ])
  })

  describe('reading goal', () => {
    const year = new Date().getFullYear()
    const finished = (month: number): number => new Date(year, month, 1, 12).getTime() / 1000

    it('sets a goal for this year and shows progress toward it', async () => {
      const bridge = installBridge({
        books: [
          makeBook({ id: 1, status: 'read', finishedAt: finished(0) }),
          makeBook({ id: 2, status: 'read', finishedAt: finished(0) })
        ]
      })
      renderApp(<Stats />)
      const user = userEvent.setup()

      await user.click(await screen.findByRole('button', { name: 'Set a reading goal' }))
      await user.type(screen.getByLabelText(`Books to finish in ${year}`), '24{Enter}')

      expect(await screen.findByText(/of 24 books/)).toBeTruthy()
      expect(bridge.goals).toEqual([{ year, books: 24 }])
      expect(screen.getByText('22 books to go')).toBeTruthy()
      const bar = screen.getByRole('progressbar', { name: `Reading goal for ${year}` })
      expect(bar.getAttribute('aria-valuenow')).toBe('2')
    })

    it('keeps the goal when editing is cancelled, and removes it when emptied', async () => {
      const bridge = installBridge({ goals: [{ year, books: 12 }] })
      renderApp(<Stats />)
      const user = userEvent.setup()

      await user.click(await screen.findByRole('button', { name: 'Change goal' }))
      await user.clear(screen.getByLabelText(`Books to finish in ${year}`))
      await user.keyboard('{Escape}')
      expect(await screen.findByText(/of 12 books/)).toBeTruthy()
      expect(bridge.goals).toEqual([{ year, books: 12 }])

      await user.click(screen.getByRole('button', { name: 'Change goal' }))
      await user.clear(screen.getByLabelText(`Books to finish in ${year}`))
      await user.keyboard('{Enter}')

      expect(await screen.findByRole('button', { name: 'Set a reading goal' })).toBeTruthy()
      expect(bridge.goals).toEqual([])
    })

    it('offers no new goal for a past year', async () => {
      installBridge({
        books: [
          makeBook({
            id: 1,
            status: 'read',
            finishedAt: new Date(year - 1, 5, 1, 12).getTime() / 1000
          })
        ]
      })
      renderApp(<Stats />)
      const user = userEvent.setup()

      await pickOption(user, 'Statistics year', String(year - 1))

      expect(screen.queryByRole('button', { name: 'Set a reading goal' })).toBeNull()
    })
  })
})
