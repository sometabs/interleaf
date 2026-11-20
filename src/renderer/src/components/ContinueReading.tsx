import type { ReactNode } from 'react'

import { useBooks, useRecentReading } from '../lib/queries'
import { useView } from '../lib/view'
import Cover from './Cover'

// Picks up where reading stopped, without going through the book page first.
export default function ContinueReading(): ReactNode {
  const { data: recent = [] } = useRecentReading()
  const { data: books = [] } = useBooks()
  const { navigate } = useView()

  const rows = recent.flatMap((position) => {
    const book = books.find((candidate) => candidate.id === position.bookId)
    return book ? [{ book, percent: Math.round(position.fraction * 100) }] : []
  })
  if (rows.length === 0) return null

  return (
    <section aria-labelledby="continue-reading" className="mb-6">
      <h2 id="continue-reading" className="eyebrow mb-2">
        Continue reading
      </h2>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
        {rows.map(({ book, percent }) => (
          <div
            key={book.id}
            className="relative flex items-center gap-3 rounded-card border border-hairline bg-surface px-3 py-2.5 hover:bg-hover"
          >
            {/* The whole card opens the book page; the button above it opens the book itself. */}
            <button
              type="button"
              aria-label={`Open ${book.title}`}
              className="absolute inset-0 rounded-card"
              onClick={() => navigate({ kind: 'book', id: book.id })}
            />
            <span className="w-10 shrink-0">
              <Cover title={book.title} author={book.author} path={book.coverPath} size="sm" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium">{book.title}</span>
              <span className="block truncate text-[12px] text-ink-muted">
                {book.author ?? 'Unknown author'}
              </span>
              <span
                role="progressbar"
                aria-label={`${book.title}: ${percent}% read`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                className="mt-2 block h-1 overflow-hidden rounded-full bg-hairline"
              >
                <span className="block h-full bg-accent" style={{ width: `${percent}%` }} />
              </span>
              <span className="mt-1 block text-[11px] tabular-nums text-ink-faint">{percent}%</span>
            </span>
            <button
              type="button"
              className="btn btn-outline relative shrink-0"
              onClick={() => navigate({ kind: 'reader', bookId: book.id })}
            >
              Continue
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
