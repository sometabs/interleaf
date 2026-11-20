import type { AttachEpubResult, Book, EpubCandidate } from '@shared/api'

import { confirm } from './confirm'
import { notify } from './feedback'

type Attach = (input: {
  bookId: number
  path: string
  replace: boolean
}) => Promise<AttachEpubResult>

// Every way of attaching a file ends here, so the questions are asked the same way everywhere.
export async function attachCandidate(
  book: Book,
  candidate: EpubCandidate,
  books: readonly Book[],
  attach: Attach
): Promise<boolean> {
  if (candidate.bookId === book.id) {
    notify('This EPUB is already attached to this book.')
    return false
  }
  if (candidate.bookId !== null) {
    const holder = books.find((other) => other.id === candidate.bookId)
    notify(`This EPUB is already attached to “${holder?.title ?? 'another book'}”.`)
    return false
  }

  let result = await attach({ bookId: book.id, path: candidate.path, replace: false })
  if (result.kind === 'replace-needed') {
    const replace = await confirm({
      title: `Replace the EPUB of “${book.title}”?`,
      body: 'Your quotes and notes stay. Highlights made in the old file may not show in the new one, since its pages differ.',
      confirmLabel: 'Replace'
    })
    if (!replace) return false
    result = await attach({ bookId: book.id, path: candidate.path, replace: true })
  }

  if (result.kind === 'attached') {
    notify(`EPUB attached to “${book.title}”.`)
    return true
  }
  if (result.kind === 'already-attached') notify('This EPUB is already attached to this book.')
  return false
}
