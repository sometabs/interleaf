import { BOOK_STATUSES, STATUS_LABELS, type Book, type BookSubjects } from '@shared/api'

import { classify, fromChosenGenres, type BookCategories, type BookGroup } from '@shared/categories'

// Every grouping returns the same shape, so the grid never learns which one it
// is drawing.
export type Grouping = 'status' | 'category' | 'author' | 'alphabet'

export const GROUPINGS: readonly { value: Grouping; label: string }[] = [
  { value: 'status', label: 'Status' },
  { value: 'category', label: 'Category' },
  { value: 'author', label: 'Author' },
  { value: 'alphabet', label: 'A–Z' }
]

export interface Shelf {
  // Stable across renders; used as the React key.
  key: string
  label: string
  books: Book[]
}

export function groupBooks(
  books: Book[],
  grouping: Grouping,
  categories: Map<number, BookCategories> = new Map()
): Shelf[] {
  if (grouping === 'category') return byCategory(books, categories)
  if (grouping === 'author') return byAuthor(books)
  if (grouping === 'alphabet') return byLetter(books)
  return byStatus(books)
}

function byStatus(books: Book[]): Shelf[] {
  return BOOK_STATUSES.map((status) => ({
    key: status,
    label: STATUS_LABELS[status],
    books: books.filter((book) => book.status === status)
  })).filter((shelf) => shelf.books.length > 0)
}

// ------------------------------------------------------------------ alphabet

const LEADING_ARTICLE = /^(the|a|an)\s+/i

// Ignores a leading article, and treats "Éclair" as an E rather than a symbol.
export function sortKey(title: string): string {
  return title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .replace(LEADING_ARTICLE, '')
    .toLowerCase()
}

// Digits and symbols share one bucket.
function initial(title: string): string {
  const first = sortKey(title).charAt(0).toUpperCase()
  return first >= 'A' && first <= 'Z' ? first : '#'
}

function byLetter(books: Book[]): Shelf[] {
  const shelves = new Map<string, Book[]>()
  for (const book of [...books].sort((a, b) => sortKey(a.title).localeCompare(sortKey(b.title)))) {
    const letter = initial(book.title)
    const shelf = shelves.get(letter)
    if (shelf) shelf.push(book)
    else shelves.set(letter, [book])
  }

  return [...shelves.entries()]
    .sort(([a], [b]) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b)))
    .map(([letter, shelfBooks]) => ({ key: letter, label: letter, books: shelfBooks }))
}

// -------------------------------------------------------------------- author

const UNKNOWN_AUTHOR = 'Unknown author'

// Stroked letters survive: ł is its own letter, so "Stanisław" and "Stanislaw"
// stay apart.
function authorKey(author: string | null): string {
  return (author ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

// Ordered as written: guessing the family name fails on particles, mononyms
// and family-first names.
function byAuthor(books: Book[]): Shelf[] {
  const shelves = new Map<string, Shelf>()

  for (const book of books) {
    const key = authorKey(book.author)
    const shelf = shelves.get(key)
    if (shelf) shelf.books.push(book)
    else shelves.set(key, { key, label: book.author?.trim() || UNKNOWN_AUTHOR, books: [book] })
  }

  return [...shelves.values()]
    .map((shelf) => ({
      ...shelf,
      books: [...shelf.books].sort((a, b) => sortKey(a.title).localeCompare(sortKey(b.title)))
    }))
    .sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : a.key.localeCompare(b.key)))
}

// ------------------------------------------------------------------ category

// Classified once so chips, counts and shelves agree.
export function categoriesOf(
  subjects: BookSubjects[],
  books: readonly Book[] = []
): Map<number, BookCategories> {
  const map = new Map(subjects.map((row) => [row.bookId, classify(row.subjects)]))

  // A reader's choice outranks anything inferred.
  for (const book of books) {
    if (book.genres === null) continue
    const chosen = fromChosenGenres(book.genres)
    if (chosen) map.set(book.id, chosen)
    // An empty choice is "none apply", not "unfiled".
    else if (book.genres.length === 0) map.delete(book.id)
  }

  return map
}

// Calling a book with no subjects non-fiction would be inventing data.
const UNFILED = 'Not categorised yet'

// Null means no subjects at all, not no genres.
function categoriesFor(book: Book, categories: Map<number, BookCategories>): BookCategories | null {
  return categories.get(book.id) ?? null
}

// Nulls mean "everything".
export function filterByCategory(
  books: Book[],
  categories: Map<number, BookCategories>,
  group: BookGroup | null,
  genre: string | null
): Book[] {
  return books.filter((book) => {
    const found = categoriesFor(book, categories)
    if (found === null) return group === null && genre === null
    if (group !== null && found.group !== group) return false
    return genre === null || found.genres.includes(genre)
  })
}

export function genresIn(books: Book[], categories: Map<number, BookCategories>): string[] {
  const counts = new Map<string, number>()
  for (const book of books) {
    for (const genre of categoriesFor(book, categories)?.genres ?? []) {
      counts.set(genre, (counts.get(genre) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .map(([genre]) => genre)
}

// A book with two genres stands on both, so the counts sum to more than the
// library holds.
function byCategory(books: Book[], categories: Map<number, BookCategories>): Shelf[] {
  const shelves = new Map<string, Book[]>()
  for (const book of books) {
    const found = categoriesFor(book, categories)
    const labels =
      found === null ? [UNFILED] : found.genres.length > 0 ? found.genres : [found.group]
    for (const label of labels) {
      const shelf = shelves.get(label)
      if (shelf) shelf.push(book)
      else shelves.set(label, [book])
    }
  }

  return [...shelves.entries()]
    .map(([label, shelfBooks]) => ({
      key: label,
      label,
      books: [...shelfBooks].sort((a, b) => sortKey(a.title).localeCompare(sortKey(b.title)))
    }))
    .sort(
      (a, b) =>
        rank(a.key) - rank(b.key) ||
        b.books.length - a.books.length ||
        a.label.localeCompare(b.label)
    )
}

function rank(label: string): number {
  if (label === UNFILED) return 2
  return label === 'Fiction' || label === 'Non-fiction' ? 1 : 0
}
