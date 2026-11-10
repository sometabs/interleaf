import type { Book } from '@shared/api'
import type { ReactNode } from 'react'

import { formatDate, readingDurationDays, toDateInput } from '../lib/dates'
import { useBooks } from '../lib/queries'
import { useView } from '../lib/view'
import Cover from './Cover'
import Rating from './Rating'

interface HistoryGroup {
  key: string
  label: string
  books: Book[]
}

function finishDate(book: Book): Date | null {
  if (book.finishedAt === null) return null
  const date = new Date(book.finishedAt * 1000)
  return Number.isFinite(date.getTime()) ? date : null
}

function groupHistory(books: Book[]): HistoryGroup[] {
  const finished = books.filter((book) => book.status === 'read')
  const sorted = finished.sort(
    (left, right) =>
      (finishDate(right)?.getTime() ?? -Infinity) - (finishDate(left)?.getTime() ?? -Infinity) ||
      left.title.localeCompare(right.title) ||
      left.id - right.id
  )
  const groups = new Map<string, HistoryGroup>()
  const month = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })

  for (const book of sorted) {
    const date = finishDate(book)
    const key = date ? `${date.getFullYear()}-${date.getMonth()}` : 'undated'
    let group = groups.get(key)
    if (!group) {
      group = { key, label: date ? month.format(date) : 'Date unknown', books: [] }
      groups.set(key, group)
    }
    group.books.push(book)
  }

  return [...groups.values()]
}

export default function ReadingHistory(): ReactNode {
  const { navigate } = useView()
  const { data: books = [], isPending } = useBooks()
  const groups = groupHistory(books)
  const total = groups.reduce((count, group) => count + group.books.length, 0)

  if (isPending) return <div className="h-full" />

  return (
    <div className="h-full overflow-y-auto px-8 pt-7 pb-16">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6">
          <h1 className="text-[22px]">Reading history</h1>
          <p className="mt-1 text-[13px] text-ink-muted">
            {total} {total === 1 ? 'book' : 'books'} finished.
          </p>
        </header>

        {total === 0 ? (
          <div className="card px-5 py-10 text-center">
            <p className="text-[15px] font-semibold">No finished books yet</p>
            <p className="mt-1 text-[13px] text-ink-muted">Mark a book as Read to see it here.</p>
          </div>
        ) : (
          <div className="space-y-7">
            {groups.map((group) => (
              <section key={group.key} aria-labelledby={`history-${group.key}`}>
                <div className="mb-2 flex items-baseline gap-2">
                  <h2 id={`history-${group.key}`} className="eyebrow">
                    {group.label}
                  </h2>
                  <span className="text-[11px] tabular-nums text-ink-faint">
                    {group.books.length} {group.books.length === 1 ? 'book' : 'books'}
                  </span>
                </div>

                <ol className="card divide-y divide-hairline overflow-hidden">
                  {group.books.map((book) => {
                    const dated = finishDate(book) !== null
                    const duration = dated
                      ? readingDurationDays(book.startedAt, book.finishedAt)
                      : null

                    return (
                      <li key={book.id}>
                        <button
                          type="button"
                          onClick={() => navigate({ kind: 'book', id: book.id })}
                          className="grid w-full grid-cols-[48px_minmax(0,1fr)] items-center gap-x-4 gap-y-2 px-4 py-3 text-left hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent sm:grid-cols-[48px_minmax(0,1fr)_auto]"
                        >
                          <div className="row-span-2 w-12 shrink-0 sm:row-span-1">
                            <Cover
                              title={book.title}
                              author={book.author}
                              path={book.coverPath}
                              size="sm"
                            />
                          </div>
                          <div className="min-w-0">
                            <h3 className="wrap-anywhere text-[15px] font-semibold">
                              {book.title}
                            </h3>
                            {book.author && (
                              <p className="mt-0.5 wrap-anywhere text-[13px] text-ink-muted">
                                {book.author}
                              </p>
                            )}
                            <div className="mt-1 text-[13px]">
                              <Rating value={book.rating} readOnly />
                            </div>
                          </div>
                          <div className="col-start-2 text-[12px] text-ink-muted sm:col-start-auto sm:text-right">
                            {dated ? (
                              <time dateTime={toDateInput(book.finishedAt)}>
                                Finished {formatDate(book.finishedAt!)}
                              </time>
                            ) : (
                              <span>Finish date not set</span>
                            )}
                            {duration !== null && (
                              <p
                                className="mt-1 text-[11px] text-ink-faint"
                                title="Elapsed calendar days from start to finish, including breaks"
                              >
                                {duration === 0
                                  ? 'Read in a day'
                                  : `Read in ${duration} ${duration === 1 ? 'day' : 'days'}`}
                              </p>
                            )}
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ol>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
