import type { Book, EpubCandidate } from '@shared/api'

// Subtitles, editions and punctuation differ between a file and a library entry.
export function normalTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s*[:([].*$/, '')
    .replace(/^(the|a|an)\s+/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function surnames(author: string | null): Set<string> {
  if (!author) return new Set()
  return new Set(
    author
      .split(/[,&;]|\band\b/)
      .map((name) => normalTitle(name).split(' ').filter(Boolean).at(-1) ?? '')
      .filter((name) => name.length > 1)
  )
}

function score(candidate: EpubCandidate, book: Book): number {
  if (candidate.isbn && book.isbn && candidate.isbn === book.isbn.replace(/[\s-]/g, '')) return 3
  const fileTitle = normalTitle(candidate.title ?? '')
  const bookTitle = normalTitle(book.title)
  if (!fileTitle || !bookTitle) return 0
  const titleMatch =
    fileTitle === bookTitle ||
    (Math.min(fileTitle.length, bookTitle.length) >= 5 &&
      (fileTitle.includes(bookTitle) || bookTitle.includes(fileTitle)))
  if (!titleMatch) return 0
  const fileAuthors = surnames(candidate.author)
  const authorMatch = [...surnames(book.author)].some((name) => fileAuthors.has(name))
  return authorMatch ? 2 : 1
}

export interface Matches {
  // The one book that clearly matches, offered on its own; null when none or several do.
  clear: Book | null
  close: Book[]
}

export function matchLibrary(candidate: EpubCandidate, books: readonly Book[]): Matches {
  const ranked = books
    .map((book) => ({ book, points: score(candidate, book) }))
    .filter(({ points }) => points > 0)
    .sort((a, b) => b.points - a.points || a.book.title.localeCompare(b.book.title))
  const best = ranked[0]?.points ?? 0
  const top = ranked.filter(({ points }) => points === best)
  return {
    clear: top.length === 1 ? top[0].book : null,
    close: ranked.map(({ book }) => book)
  }
}
