import { BOOK_STATUSES, STATUS_LABELS, type Book } from '@shared/api'

// Every grouping returns the same shape, so the grid never learns which one it
// is drawing.
export type Grouping = 'status' | 'author' | 'alphabet'

export const GROUPINGS: readonly { value: Grouping; label: string }[] = [
  { value: 'status', label: 'Status' },
  { value: 'author', label: 'Author' },
  { value: 'alphabet', label: 'A–Z' }
]

export interface Shelf {
  // Stable across renders; used as the React key.
  key: string
  label: string
  books: Book[]
}

export function groupBooks(books: Book[], grouping: Grouping): Shelf[] {
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
