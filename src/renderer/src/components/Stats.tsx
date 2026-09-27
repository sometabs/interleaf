import type { ReactNode } from 'react'

import { useBooks, useNotes } from '../lib/queries'
import { calculateStats, type CountedLabel } from '../lib/stats'

const number = new Intl.NumberFormat()

export default function Stats(): ReactNode {
  const { data: books = [], isPending: booksPending } = useBooks()
  const { data: notes = [], isPending: notesPending } = useNotes()
  const stats = calculateStats(books, notes, new Date().getFullYear())

  if (booksPending || notesPending) return <div className="h-full" />

  return (
    <div className="h-full overflow-y-auto px-8 pt-7 pb-16">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6">
          <h1 className="text-[22px]">Stats</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            A local snapshot of your library and reading journal.
          </p>
        </header>

        <section aria-labelledby="overview-heading">
          <h2 id="overview-heading" className="eyebrow mb-2">
            All time
          </h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="Books" value={number.format(stats.totalBooks)} />
            <Metric label="Read" value={number.format(stats.readBooks)} />
            <Metric
              label="Pages read"
              value={number.format(stats.pagesRead)}
              detail={pageCoverage(stats.pageCountsKnown, stats.readBooks)}
            />
            <Metric
              label="Average rating"
              value={stats.averageRating === null ? '—' : stats.averageRating.toFixed(1)}
              detail={
                stats.ratedBooks === 0
                  ? 'No rated books'
                  : `${stats.ratedBooks} rated ${stats.ratedBooks === 1 ? 'book' : 'books'}`
              }
            />
          </div>
        </section>

        <section aria-labelledby="year-heading" className="mt-8">
          <h2 id="year-heading" className="eyebrow mb-2">
            {stats.year}
          </h2>
          <div className="card grid gap-6 p-5 md:grid-cols-[180px_1fr]">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-1">
              <SmallMetric label="Books finished" value={number.format(stats.yearBooks)} />
              <SmallMetric
                label="Pages read"
                value={number.format(stats.yearPages)}
                detail={pageCoverage(stats.yearPageCountsKnown, stats.yearBooks)}
              />
            </div>
            <MonthlyChart months={stats.months} />
          </div>
        </section>

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <section aria-labelledby="status-heading">
            <h2 id="status-heading" className="eyebrow mb-2">
              Library status
            </h2>
            <div className="card p-4">
              <BarList rows={stats.statuses} total={stats.totalBooks} tone="accent" />
            </div>
          </section>

          <section aria-labelledby="ratings-heading">
            <h2 id="ratings-heading" className="eyebrow mb-2">
              Ratings
            </h2>
            <div className="card p-4">
              <BarList rows={stats.ratings} total={stats.ratedBooks} tone="star" />
            </div>
          </section>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <section aria-labelledby="authors-heading">
            <h2 id="authors-heading" className="eyebrow mb-2">
              Top authors
            </h2>
            <div className="card p-4">
              {stats.topAuthors.length === 0 ? (
                <p className="py-5 text-center text-[13px] text-ink-muted">
                  No completed books with authors yet.
                </p>
              ) : (
                <ol className="space-y-1">
                  {stats.topAuthors.map((author, index) => (
                    <li
                      key={author.label.toLocaleLowerCase()}
                      className="flex items-center gap-3 rounded-control px-2 py-2"
                    >
                      <span className="w-5 text-right text-[12px] tabular-nums text-ink-faint">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px]">{author.label}</span>
                      <span className="text-[12px] tabular-nums text-ink-muted">
                        {author.count} {author.count === 1 ? 'book' : 'books'}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>

          <section aria-labelledby="journal-heading">
            <h2 id="journal-heading" className="eyebrow mb-2">
              Journal activity
            </h2>
            <div className="card grid grid-cols-3 divide-x divide-hairline p-4">
              <SmallMetric label="Reviews" value={number.format(stats.journal.reviews)} centered />
              <SmallMetric label="Notes" value={number.format(stats.journal.notes)} centered />
              <SmallMetric label="Quotes" value={number.format(stats.journal.quotes)} centered />
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function Metric({
  label,
  value,
  detail
}: {
  label: string
  value: string
  detail?: string
}): ReactNode {
  return (
    <div className="card min-h-28 p-4">
      <p className="text-[12px] text-ink-muted">{label}</p>
      <p className="mt-1 text-[28px] font-semibold leading-none tracking-tight tabular-nums">
        {value}
      </p>
      {detail && <p className="mt-2 text-[11px] leading-snug text-ink-faint">{detail}</p>}
    </div>
  )
}

function SmallMetric({
  label,
  value,
  detail,
  centered = false
}: {
  label: string
  value: string
  detail?: string
  centered?: boolean
}): ReactNode {
  return (
    <div className={centered ? 'px-2 text-center' : ''}>
      <p className="text-[11px] text-ink-muted">{label}</p>
      <p className="mt-0.5 text-[22px] font-semibold leading-tight tabular-nums">{value}</p>
      {detail && <p className="mt-1 text-[10px] leading-snug text-ink-faint">{detail}</p>}
    </div>
  )
}

function MonthlyChart({ months }: { months: CountedLabel[] }): ReactNode {
  const maximum = Math.max(0, ...months.map((month) => month.count))

  return (
    <div>
      <p className="mb-3 text-[12px] text-ink-muted">Books finished by month</p>
      <div className="flex h-40 items-end gap-2 border-b border-hairline-strong px-1">
        {months.map((month) => {
          const height = maximum === 0 ? 0 : Math.max(7, (month.count / maximum) * 128)
          return (
            <div
              key={month.label}
              className="flex h-full min-w-0 flex-1 flex-col items-center justify-end"
              aria-label={`${month.label}: ${month.count} ${month.count === 1 ? 'book' : 'books'}`}
            >
              {month.count > 0 && (
                <span className="mb-1 text-[10px] tabular-nums text-ink-muted">{month.count}</span>
              )}
              <span
                className="w-full max-w-8 rounded-t-[2px] bg-accent"
                style={{ height }}
                aria-hidden="true"
              />
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex gap-2 px-1" aria-hidden="true">
        {months.map((month) => (
          <span key={month.label} className="min-w-0 flex-1 text-center text-[9px] text-ink-faint">
            {month.label.slice(0, 1)}
          </span>
        ))}
      </div>
      {maximum === 0 && (
        <p className="mt-3 text-center text-[11px] text-ink-faint">
          No books with completion dates this year.
        </p>
      )}
    </div>
  )
}

function BarList({
  rows,
  total,
  tone
}: {
  rows: CountedLabel[]
  total: number
  tone: 'accent' | 'star'
}): ReactNode {
  const maximum = Math.max(0, ...rows.map((row) => row.count))

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="mb-1 flex items-center justify-between text-[12px]">
            <span className={tone === 'star' ? 'text-star' : 'text-ink-muted'}>
              {tone === 'star' ? '★'.repeat(Number(row.label.split(' ')[0])) : row.label}
            </span>
            <span className="tabular-nums text-ink-muted">{row.count}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
            <div
              className={`h-full rounded-full ${tone === 'star' ? 'bg-star' : 'bg-accent'}`}
              style={{ width: maximum === 0 ? 0 : `${(row.count / maximum) * 100}%` }}
            />
          </div>
        </div>
      ))}
      {total === 0 && <p className="pt-1 text-center text-[11px] text-ink-faint">No data yet.</p>}
    </div>
  )
}

function pageCoverage(known: number, total: number): string | undefined {
  if (total === 0 || known === total) return undefined
  return `Based on ${known} of ${total} books with page counts`
}
