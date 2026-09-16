import { type Book, type MetadataRefreshProgress, type MetadataRefreshResult } from '@shared/api'
import { useState, type ReactNode } from 'react'

import { confirm } from '../lib/confirm'
import { notify } from '../lib/feedback'
import {
  useBooks,
  useCancelMetadataRefresh,
  useMetadataRefreshProgress,
  useRefreshAllMetadata,
  useRetryMetadataRefresh
} from '../lib/queries'
import { groupBooks, GROUPINGS, type Grouping, type Shelf } from '../lib/shelves'
import { useView } from '../lib/view'
import Cover from './Cover'
import Empty from './Empty'
import Rating from './Rating'

interface Props {
  onAdd: () => void
}

export default function Library({ onAdd }: Props): ReactNode {
  const { navigate } = useView()
  const { data: books = [], isPending } = useBooks()
  const refresh = useRefreshAllMetadata()
  const retryRefresh = useRetryMetadataRefresh()
  const cancelRefresh = useCancelMetadataRefresh()
  const refreshing = refresh.isPending || retryRefresh.isPending
  const progress = useMetadataRefreshProgress(refreshing)

  const [filter, setFilter] = useState('')
  const [grouping, setGrouping] = useState<Grouping>('status')
  const [refreshResult, setRefreshResult] = useState<MetadataRefreshResult | null>(null)
  const [stopRequested, setStopRequested] = useState(false)

  const query = filter.trim().toLowerCase()
  const matching = query
    ? books.filter(
        (book) =>
          book.title.toLowerCase().includes(query) ||
          (book.author ?? '').toLowerCase().includes(query)
      )
    : books

  const shelves = groupBooks(matching, grouping)

  if (isPending) return <div className="h-full" />

  if (books.length === 0) {
    return (
      <Empty
        title="Your library is empty"
        action={
          <button type="button" className="btn btn-primary" onClick={onAdd}>
            Add a book
          </button>
        }
      />
    )
  }

  async function startMetadataRefresh(): Promise<void> {
    const ok = await confirm({
      title: `Refresh metadata for all ${books.length} books?`,
      body: `Open Library will refresh each current book by its stored Work ID, one at a time, using about ${books.length * 2} metadata requests. Your ratings, status, notes, dates and categories will not change.`,
      confirmLabel: 'Refresh all'
    })
    if (!ok) return

    setRefreshResult(null)
    setStopRequested(false)
    refresh.mutate(undefined, {
      onSuccess: finishMetadataRefresh,
      onSettled: () => setStopRequested(false)
    })
  }

  function finishMetadataRefresh(result: MetadataRefreshResult): void {
    setRefreshResult(result)
    if (!result.cancelled && !result.offline && result.failures.length === 0) {
      notify(
        `Refreshed metadata for ${result.refreshed} ${result.refreshed === 1 ? 'book' : 'books'}.`
      )
    }
  }

  function retryFailures(): void {
    if (!refreshResult || refreshResult.failures.length === 0) return
    const ids = refreshResult.failures.map((failure) => failure.bookId)
    setRefreshResult(null)
    setStopRequested(false)
    retryRefresh.mutate(ids, {
      onSuccess: finishMetadataRefresh,
      onSettled: () => setStopRequested(false)
    })
  }

  return (
    <div className="h-full overflow-y-auto px-8 pt-7 pb-16">
      <header className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="mr-auto text-[22px]">Library</h1>

        {refreshing ? (
          <button
            type="button"
            className="btn"
            disabled={stopRequested}
            onClick={() => {
              setStopRequested(true)
              cancelRefresh.mutate()
            }}
          >
            {stopRequested ? 'Stopping…' : 'Cancel refresh'}
          </button>
        ) : (
          <button type="button" className="btn" onClick={() => void startMetadataRefresh()}>
            Refresh all metadata
          </button>
        )}

        <Segmented label="Group by" options={GROUPINGS} value={grouping} onChange={setGrouping} />

        <input
          className="field max-w-64"
          placeholder="Filter by title or author…"
          aria-label="Filter library"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </header>

      {refreshing && <MetadataProgressPanel progress={progress} />}
      {!refreshing &&
        refreshResult &&
        (refreshResult.cancelled || refreshResult.offline || refreshResult.failures.length > 0) && (
          <MetadataRefreshSummary result={refreshResult} onRetry={retryFailures} />
        )}

      {matching.length === 0 ? (
        <p className="py-8 text-center text-ink-muted">
          {query ? `Nothing matches “${filter.trim()}”.` : 'Nothing here yet.'}
        </p>
      ) : (
        shelves.map((shelf) => (
          <ShelfSection
            key={shelf.key}
            shelf={shelf}
            onOpen={(book) => navigate({ kind: 'book', id: book.id })}
          />
        ))
      )}
    </div>
  )
}

function MetadataProgressPanel({
  progress
}: {
  progress: MetadataRefreshProgress | null
}): ReactNode {
  const total = progress?.total ?? 0
  const done = progress?.done ?? 0
  const share = total > 0 ? Math.min(done / total, 1) : 0

  return (
    <section aria-label="Metadata refresh progress" className="card mb-6 px-5 py-4">
      <div className="mb-2.5 flex items-baseline justify-between gap-4">
        <p aria-live="polite" className="min-w-0 truncate text-[13px] text-ink">
          {progress?.label ?? 'Contacting Open Library…'}
        </p>
        {total > 0 && (
          <p className="shrink-0 text-[12px] tabular-nums text-ink-faint">
            {done} of {total}
          </p>
        )}
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total || 1}
        aria-valuenow={done}
        className="h-1 overflow-hidden rounded-full bg-sunken"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300"
          style={{ width: `${Math.round(share * 100)}%` }}
        />
      </div>
    </section>
  )
}

function MetadataRefreshSummary({
  result,
  onRetry
}: {
  result: MetadataRefreshResult
  onRetry: () => void
}): ReactNode {
  const refreshedBooks = `${result.refreshed} ${result.refreshed === 1 ? 'book' : 'books'}`
  return (
    <section aria-label="Metadata refresh summary" className="card mb-6 px-5 py-4 text-[13px]">
      <p className="text-ink">
        {result.cancelled
          ? `Refresh stopped after ${refreshedBooks}.`
          : result.offline
            ? `Refresh paused because Open Library became unreachable. ${refreshedBooks} refreshed.`
            : `${refreshedBooks} refreshed; ${result.failures.length} could not be matched.`}
      </p>
      {result.failures.length > 0 && (
        <>
          <details className="mt-2 text-ink-muted">
            <summary className="cursor-pointer">
              Books needing attention ({result.failures.length})
            </summary>
            <ul className="mt-2 space-y-1 pl-5">
              {result.failures.map((failure) => (
                <li key={failure.bookId}>
                  <span className="font-medium text-ink">{failure.title}</span> — {failure.reason}
                </li>
              ))}
            </ul>
          </details>
          <button type="button" className="btn mt-3" onClick={onRetry}>
            Retry failed books
          </button>
        </>
      )}
    </section>
  )
}

// One control for both rows: a select would hide the options and make the two
// levels look unrelated.
function Segmented<T extends string | null>({
  label,
  options,
  value,
  onChange
}: {
  label: string
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}): ReactNode {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex w-fit rounded-control border border-hairline-strong bg-surface p-0.5"
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.label}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`rounded-[2px] px-3 py-1 text-[13px] font-medium transition-colors ${
              active ? 'bg-sunken text-ink' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function ShelfSection({
  shelf,
  onOpen
}: {
  shelf: Shelf
  onOpen: (book: Book) => void
}): ReactNode {
  return (
    <section className="mb-9">
      <h2 className="eyebrow mb-3">
        {shelf.label} · {shelf.books.length}
      </h2>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(136px,1fr))] gap-x-4 gap-y-6">
        {shelf.books.map((book) => (
          <button
            key={book.id}
            type="button"
            onClick={() => onOpen(book)}
            className="group flex flex-col text-left"
          >
            <div className="transition-transform duration-150 group-hover:-translate-y-1">
              <Cover title={book.title} author={book.author} path={book.coverPath} />
            </div>
            <span className="mt-2.5 line-clamp-2 text-[13px] font-medium leading-snug">
              {book.title}
            </span>
            {book.author && (
              <span className="truncate text-[12px] text-ink-muted">{book.author}</span>
            )}
            {book.rating !== null && (
              <span className="mt-1 text-[12px]">
                <Rating value={book.rating} readOnly />
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  )
}
