import { toPlainText } from '@shared/plaintext'
import { useState, type ReactNode } from 'react'

import { formatDate } from '../lib/dates'
import { useBooks, useNotes } from '../lib/queries'
import { reviewEntries } from '../lib/reviews'
import { useView } from '../lib/view'
import Cover from './Cover'
import Empty from './Empty'
import FilterPicker from './FilterPicker'
import Rating from './Rating'

const ANY = ''

export default function Reviews(): ReactNode {
  const { navigate } = useView()
  const { data: notes = [], isPending: notesPending } = useNotes()
  const { data: books = [], isPending: booksPending } = useBooks()

  const [filter, setFilter] = useState('')
  const [ratingFilter, setRatingFilter] = useState(ANY)

  const reviews = reviewEntries(books, notes).sort(
    (a, b) =>
      (b.book.finishedAt ?? -Infinity) - (a.book.finishedAt ?? -Infinity) ||
      (b.review?.updatedAt ?? 0) - (a.review?.updatedAt ?? 0)
  )

  const query = filter.trim().toLowerCase()

  const matching = reviews.filter(({ book, review }) => {
    if (ratingFilter !== ANY && book.rating !== Number(ratingFilter)) return false
    if (!query) return true

    return [review?.bodyMd ?? '', book.title, book.author ?? '']
      .join('\n')
      .toLowerCase()
      .includes(query)
  })

  const narrowed = query !== '' || ratingFilter !== ANY

  if (booksPending || notesPending) return <div className="h-full" />

  return (
    <div className="h-full overflow-y-auto px-8 pt-7 pb-16">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-[22px]">Reviews</h1>
            <p className="mt-0.5 text-[13px] text-ink-muted">
              {narrowed
                ? `${matching.length} of ${reviews.length}`
                : `${reviews.length} ${reviews.length === 1 ? 'book' : 'books'} you’ve rated or reviewed`}
            </p>
          </div>

          {reviews.length > 0 && (
            <input
              className="field max-w-56 shrink-0"
              type="search"
              placeholder="Search reviews…"
              aria-label="Search reviews"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          )}
        </header>

        {reviews.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <FilterPicker
              label="Filter by rating"
              value={ratingFilter}
              onChange={setRatingFilter}
              active={ratingFilter !== ANY}
              options={[
                { value: ANY, label: 'All ratings' },
                ...[5, 4, 3, 2, 1].map((stars) => ({
                  value: String(stars),
                  label: `${stars} ${stars === 1 ? 'star' : 'stars'}`
                }))
              ]}
            />

            {narrowed && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setFilter('')
                  setRatingFilter(ANY)
                }}
              >
                Clear
              </button>
            )}
          </div>
        )}

        {reviews.length === 0 ? (
          <Empty title="No reviews yet">Rate a book or write a review on its book page.</Empty>
        ) : matching.length === 0 ? (
          <p className="py-8 text-center text-ink-muted">
            {query ? `Nothing matches “${filter.trim()}”.` : 'No reviews at that rating.'}
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {matching.map(({ book, review }) => {
              const excerpt = review ? toPlainText(review.bodyMd).slice(0, 300) : ''
              return (
                <button
                  key={book.id}
                  type="button"
                  data-testid="review-row"
                  onClick={() => navigate({ kind: 'review', bookId: book.id })}
                  className="flex gap-3.5 rounded-card px-3 py-3 text-left hover:bg-hover"
                >
                  <span className="w-11 shrink-0">
                    <Cover
                      title={book.title}
                      author={book.author}
                      path={book.coverPath}
                      size="sm"
                    />
                  </span>

                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate font-medium">{book.title}</span>
                      {book.finishedAt !== null && (
                        <span className="shrink-0 text-[11px] text-ink-faint">
                          {formatDate(book.finishedAt)}
                        </span>
                      )}
                    </span>

                    <span className="flex items-center gap-2 text-[12px] text-ink-muted">
                      {book.rating !== null && <Rating value={book.rating} readOnly />}
                      {book.author && <span className="truncate">{book.author}</span>}
                    </span>

                    <span
                      className={`line-clamp-3 min-w-0 wrap-anywhere text-[13px] leading-snug ${
                        excerpt ? 'text-ink-muted' : 'italic text-ink-faint'
                      }`}
                    >
                      {excerpt || 'No review'}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
