import type { ReactNode } from 'react'

import { confirm } from '../lib/confirm'
import { formatDate } from '../lib/dates'
import { useBook, useDeleteNote, useNote, useUpdateBook, useUpdateNote } from '../lib/queries'
import { SCREEN_NAMES, useView } from '../lib/view'
import Cover from './Cover'
import Editor from './Editor'
import Empty from './Empty'
import Rating from './Rating'

interface Props {
  noteId: number
}

export default function ReviewView({ noteId }: Props): ReactNode {
  const { navigate, previous, back } = useView()
  const { data: review, isPending } = useNote(noteId)
  const book = useBook(review?.bookId ?? null)

  const updateNote = useUpdateNote()
  const updateBook = useUpdateBook()
  const deleteNote = useDeleteNote()

  if (isPending) return <div className="h-full" />
  if (!review) return <Empty title="This review no longer exists." />
  if (!book) return <Empty title="The book this review belongs to is gone." />

  const title = book.title

  async function remove(): Promise<void> {
    const ok = await confirm({
      title: `Delete your review of “${title}”?`,
      body: 'The book and everything else about it stays. This cannot be undone.',
      confirmLabel: 'Delete review',
      destructive: true
    })
    if (!ok) return
    deleteNote.mutate(noteId, { onSuccess: () => navigate({ kind: 'reviews' }) })
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-8 pt-6 pb-6">
      <div className="mb-4 flex items-center gap-1">
        <button
          type="button"
          className="btn btn-ghost -ml-2"
          onClick={() => (previous ? back() : navigate({ kind: 'reviews' }))}
        >
          ← {previous ? SCREEN_NAMES[previous.kind] : 'Reviews'}
        </button>

        <span className="flex-1" />
        <button
          type="button"
          className="btn btn-ghost"
          title={`Open ${book.title}`}
          onClick={() => navigate({ kind: 'book', id: book.id })}
        >
          Open the book →
        </button>
        <button type="button" className="btn btn-ghost btn-danger" onClick={() => void remove()}>
          Delete
        </button>
      </div>

      <header className="flex items-start gap-4">
        <span className="w-14 shrink-0">
          <Cover title={book.title} author={book.author} path={book.coverPath} size="sm" />
        </span>

        <div className="min-w-0 flex-1">
          {/* The book names the review, so there is no title to type. */}
          <h1 className="text-[24px] font-semibold wrap-anywhere">{book.title}</h1>
          {book.author && <p className="text-[14px] text-ink-muted">{book.author}</p>}

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-faint">
            <Rating
              value={book.rating}
              onChange={(rating) => updateBook.mutate({ id: book.id, patch: { rating } })}
            />
            {book.finishedAt !== null && <span>Finished {formatDate(book.finishedAt)}</span>}
          </div>
        </div>
      </header>

      <div className="card mt-5 min-h-0 flex-1 px-5 py-4">
        <Editor
          key={review.id}
          value={review.bodyMd}
          placeholder="What did you make of it?"
          onSave={(text) => updateNote.mutate({ id: review.id, patch: { bodyMd: text } })}
        />
      </div>
    </div>
  )
}
