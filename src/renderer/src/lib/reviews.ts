import type { Book, Note } from '@shared/api'
import { toPlainText } from '@shared/plaintext'

export function reviewEntries(books: Book[], notes: Note[]): { book: Book; review?: Note }[] {
  const byBook = new Map<number, Note>()
  for (const note of notes) {
    if (note.kind === 'review' && note.bookId !== null && toPlainText(note.bodyMd)) {
      byBook.set(note.bookId, note)
    }
  }

  return books.flatMap((book) => {
    const review = byBook.get(book.id)
    return review || book.rating !== null ? [{ book, review }] : []
  })
}
