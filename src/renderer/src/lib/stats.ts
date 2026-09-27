import type { Book, BookStatus, Note } from '@shared/api'
import { STATUS_LABELS } from '@shared/api'

export interface CountedLabel {
  label: string
  count: number
}

export interface LibraryStats {
  totalBooks: number
  readBooks: number
  pagesRead: number
  pageCountsKnown: number
  averageRating: number | null
  ratedBooks: number
  year: number
  yearBooks: number
  yearPages: number
  yearPageCountsKnown: number
  months: CountedLabel[]
  statuses: (CountedLabel & { status: BookStatus })[]
  ratings: (CountedLabel & { rating: number })[]
  topAuthors: CountedLabel[]
  journal: {
    reviews: number
    notes: number
    quotes: number
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function calculateStats(
  books: readonly Book[],
  notes: readonly Note[],
  year: number
): LibraryStats {
  const read = books.filter((book) => book.status === 'read')
  const withPages = read.filter(hasPages)
  const rated = books.filter((book) => book.rating !== null)
  const finishedThisYear = read.filter(
    (book) => book.finishedAt !== null && new Date(book.finishedAt * 1000).getFullYear() === year
  )
  const yearWithPages = finishedThisYear.filter(hasPages)

  const months = MONTHS.map((label) => ({ label, count: 0 }))
  for (const book of finishedThisYear) {
    months[new Date((book.finishedAt as number) * 1000).getMonth()].count += 1
  }

  const statusOrder: BookStatus[] = ['reading', 'want', 'read', 'abandoned']
  const statuses = statusOrder.map((status) => ({
    status,
    label: STATUS_LABELS[status],
    count: books.filter((book) => book.status === status).length
  }))

  const ratings = [5, 4, 3, 2, 1].map((rating) => ({
    rating,
    label: `${rating} ${rating === 1 ? 'star' : 'stars'}`,
    count: rated.filter((book) => book.rating === rating).length
  }))

  const authors = new Map<string, CountedLabel>()
  for (const book of read) {
    const name = book.author?.trim()
    if (!name) continue
    const key = name.toLocaleLowerCase()
    const current = authors.get(key)
    if (current) current.count += 1
    else authors.set(key, { label: name, count: 1 })
  }

  const topAuthors = [...authors.values()]
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, 5)

  return {
    totalBooks: books.length,
    readBooks: read.length,
    pagesRead: withPages.reduce((total, book) => total + (book.pageCount as number), 0),
    pageCountsKnown: withPages.length,
    averageRating:
      rated.length === 0
        ? null
        : rated.reduce((total, book) => total + (book.rating as number), 0) / rated.length,
    ratedBooks: rated.length,
    year,
    yearBooks: finishedThisYear.length,
    yearPages: yearWithPages.reduce((total, book) => total + (book.pageCount as number), 0),
    yearPageCountsKnown: yearWithPages.length,
    months,
    statuses,
    ratings,
    topAuthors,
    journal: {
      reviews: notes.filter((note) => note.kind === 'review').length,
      notes: notes.filter((note) => note.kind === 'thought').length,
      quotes: notes.filter((note) => note.kind === 'highlight').length
    }
  }
}

function hasPages(book: Book): boolean {
  return book.pageCount !== null && book.pageCount > 0
}
