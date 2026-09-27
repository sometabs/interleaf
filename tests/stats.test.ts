import { describe, expect, it } from 'vitest'

import { calculateStats } from '../src/renderer/src/lib/stats'
import { makeBook, makeNote } from './helpers/render'

function date(year: number, month: number, day: number): number {
  return Math.floor(new Date(year, month, day, 12).getTime() / 1000)
}

describe('library statistics', () => {
  it('summarizes the shelf, current year and journal without inventing missing pages', () => {
    const books = [
      makeBook({
        id: 1,
        title: 'The Dispossessed',
        author: 'Ursula K. Le Guin',
        status: 'read',
        rating: 5,
        pageCount: 320,
        finishedAt: date(2026, 0, 12)
      }),
      makeBook({
        id: 2,
        title: 'A Wizard of Earthsea',
        author: 'Ursula K. Le Guin',
        status: 'read',
        rating: 3,
        pageCount: null,
        finishedAt: date(2025, 7, 2)
      }),
      makeBook({
        id: 3,
        title: 'Dune',
        author: 'Frank Herbert',
        status: 'reading',
        rating: 4,
        pageCount: 500
      }),
      makeBook({ id: 4, title: 'Next', status: 'want' })
    ]
    const notes = [
      makeNote({ id: 1, kind: 'review' }),
      makeNote({ id: 2, kind: 'thought' }),
      makeNote({ id: 3, kind: 'highlight' }),
      makeNote({ id: 4, kind: 'highlight' })
    ]

    const stats = calculateStats(books, notes, 2026)

    expect(stats).toMatchObject({
      totalBooks: 4,
      readBooks: 2,
      pagesRead: 320,
      pageCountsKnown: 1,
      averageRating: 4,
      ratedBooks: 3,
      yearBooks: 1,
      yearPages: 320,
      yearPageCountsKnown: 1,
      journal: { reviews: 1, notes: 1, quotes: 2 }
    })
    expect(stats.months[0].count).toBe(1)
    expect(stats.months.slice(1).every((month) => month.count === 0)).toBe(true)
    expect(stats.statuses.map(({ status, count }) => [status, count])).toEqual([
      ['reading', 1],
      ['want', 1],
      ['read', 2],
      ['abandoned', 0]
    ])
    expect(stats.ratings.map(({ rating, count }) => [rating, count])).toEqual([
      [5, 1],
      [4, 1],
      [3, 1],
      [2, 0],
      [1, 0]
    ])
    expect(stats.topAuthors).toEqual([{ label: 'Ursula K. Le Guin', count: 2 }])
  })
})
