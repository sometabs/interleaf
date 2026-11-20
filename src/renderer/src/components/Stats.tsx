import { useRef, useState, type ReactNode } from 'react'

import type { ReadingTimeSummary } from '@shared/api'

import {
  useBooks,
  useNotes,
  useReadingGoals,
  useReadingTimeSummary,
  useSetReadingGoal
} from '../lib/queries'
import { formatDuration } from '../lib/readingClock'
import { calculateStats, goalStatus, readingYears, type CountedLabel } from '../lib/stats'
import FilterPicker from './FilterPicker'

const number = new Intl.NumberFormat()

export default function Stats(): ReactNode {
  const { data: books = [], isPending: booksPending } = useBooks()
  const { data: notes = [], isPending: notesPending } = useNotes()
  const { data: time } = useReadingTimeSummary()
  const currentYear = new Date().getFullYear()
  const [selectedYear, setSelectedYear] = useState<number | 'all' | null>(null)
  const years = readingYears(books, currentYear)
  const allTime = selectedYear === 'all'
  const year =
    typeof selectedYear === 'number' && years.includes(selectedYear) ? selectedYear : currentYear
  const stats = calculateStats(books, notes, year)
  const periodBooks = allTime ? stats.readBooks : stats.yearBooks
  const periodPages = allTime ? stats.pagesRead : stats.yearPages
  const periodPageCountsKnown = allTime ? stats.pageCountsKnown : stats.yearPageCountsKnown

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
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 id="year-heading" className="eyebrow">
              Reading by year
            </h2>
            <FilterPicker
              label="Statistics year"
              align="end"
              value={allTime ? 'all' : String(year)}
              onChange={(next) => setSelectedYear(next === 'all' ? 'all' : Number(next))}
              options={[
                { value: 'all', label: 'All time' },
                ...years.map((availableYear) => ({
                  value: String(availableYear),
                  label: String(availableYear)
                }))
              ]}
            />
          </div>
          <div className="card grid gap-6 p-5 md:grid-cols-[180px_1fr]">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-1">
              <SmallMetric label="Books finished" value={number.format(periodBooks)} />
              <SmallMetric
                label="Pages read"
                value={number.format(periodPages)}
                detail={pageCoverage(periodPageCountsKnown, periodBooks)}
              />
              {!allTime && (
                <div className="col-span-2 md:col-span-1">
                  <ReadingGoal
                    year={year}
                    finished={stats.yearBooks}
                    current={year === currentYear}
                  />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <CompletionChart
                rows={allTime ? stats.yearlyCompletions : stats.months}
                period={allTime ? 'year' : 'month'}
              />
              {allTime &&
                stats.readBooks >
                  stats.yearlyCompletions.reduce((total, row) => total + row.count, 0) && (
                  <p className="mt-3 text-[11px] text-ink-faint">
                    Books without a finished date are included in totals, but not the chart.
                  </p>
                )}
            </div>
          </div>
        </section>

        {time?.anySessions && <ReadingTime time={time} />}

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <section aria-labelledby="status-heading">
            <h2 id="status-heading" className="eyebrow mb-2">
              Library status
            </h2>
            <div className="card p-4">
              <BarList rows={stats.statuses} total={stats.totalBooks} />
            </div>
          </section>

          <section aria-labelledby="ratings-heading">
            <h2 id="ratings-heading" className="eyebrow mb-2">
              Ratings
            </h2>
            <div className="card p-4">
              <RatingHistogram rows={stats.ratings} />
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

const weekLabel = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

function ReadingTime({ time }: { time: ReadingTimeSummary }): ReactNode {
  const most = Math.max(0, ...time.weeks.map((week) => week.seconds))
  const first = time.weeks[0]
  return (
    <section aria-labelledby="time-heading" className="mt-8">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 id="time-heading" className="eyebrow">
          Time reading
        </h2>
        <span className="text-[11px] text-ink-faint">In the Interleaf reader</span>
      </div>
      <div className="card grid gap-6 p-5 md:grid-cols-[180px_1fr]">
        <div className="grid grid-cols-3 gap-3 md:grid-cols-1">
          <SmallMetric label="This year" value={formatDuration(time.yearSeconds)} />
          <SmallMetric label="This week" value={formatDuration(time.weekSeconds)} />
          <SmallMetric
            label="Usual session"
            value={
              time.usualSessionSeconds === null ? '—' : formatDuration(time.usualSessionSeconds)
            }
          />
        </div>
        <div className="min-w-0">
          <p className="mb-3 text-[12px] text-ink-muted">Last 12 weeks</p>
          <div className="flex h-28 items-end gap-2 border-b border-hairline-strong px-1">
            {time.weeks.map((week, index) => {
              const current = index === time.weeks.length - 1
              const label = `${current ? 'This week' : `Week of ${weekLabel.format(week.start * 1000)}`}: ${formatDuration(week.seconds)}`
              return (
                <div
                  key={week.start}
                  role="img"
                  aria-label={label}
                  title={label}
                  className="flex h-full min-w-0 flex-1 items-end justify-center"
                >
                  {week.seconds > 0 && (
                    <span
                      className={`w-full max-w-8 rounded-t-[2px] ${current ? 'bg-accent' : 'bg-accent-soft'}`}
                      style={{ height: Math.max(4, (week.seconds / most) * 104) }}
                    />
                  )}
                </div>
              )
            })}
          </div>
          <div className="mt-1 flex justify-between px-1 text-[10px] text-ink-faint">
            <span>{first ? weekLabel.format(first.start * 1000) : ''}</span>
            <span>This week</span>
          </div>
          {time.topBooks.length > 0 && (
            <>
              <p className="mt-5 mb-1.5 text-[12px] text-ink-muted">Most time this year</p>
              <ol className="space-y-1 text-[13px]">
                {time.topBooks.map((book) => (
                  <li key={book.bookId} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate">{book.title}</span>
                    <span className="shrink-0 tabular-nums text-ink-muted">
                      {formatDuration(book.seconds)}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      </div>
    </section>
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

function ReadingGoal({
  year,
  finished,
  current
}: {
  year: number
  finished: number
  current: boolean
}): ReactNode {
  const { data: goals = [] } = useReadingGoals()
  const setGoal = useSetReadingGoal()
  const goal = goals.find((saved) => saved.year === year)?.books ?? null
  const [draft, setDraft] = useState<string | null>(null)
  // Enter or Escape unmounts the field, which may also fire blur: settle only once.
  const settled = useRef(false)

  const edit = (): void => {
    settled.current = false
    setDraft(goal === null ? '' : String(goal))
  }
  const finish = (save: boolean): void => {
    if (settled.current || draft === null) return
    settled.current = true
    setDraft(null)
    if (!save) return
    const next = draft.trim() === '' ? null : Number(draft)
    if (next !== null && (!Number.isInteger(next) || next < 1)) return
    if (next !== goal) setGoal.mutate({ year, books: next })
  }

  if (draft !== null) {
    return (
      <label className="block">
        <span className="text-[11px] text-ink-muted">Books to finish in {year}</span>
        <input
          inputMode="numeric"
          autoFocus
          aria-label={`Books to finish in ${year}`}
          className="field mt-1 w-full text-[13px]"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') finish(true)
            if (event.key === 'Escape') finish(false)
            // Otherwise Escape would also reach the app's global "back" shortcut.
            event.stopPropagation()
          }}
        />
        <span className="mt-1 block text-[10px] text-ink-faint">Empty removes the goal.</span>
      </label>
    )
  }

  if (goal === null) {
    if (!current) return null
    return (
      <button type="button" className="btn btn-ghost -ml-2 text-[12px]" onClick={edit}>
        Set a reading goal
      </button>
    )
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] text-ink-muted">Goal</p>
        <button
          type="button"
          aria-label="Change goal"
          className="text-[11px] text-ink-faint hover:text-ink"
          onClick={edit}
        >
          Change
        </button>
      </div>
      <p className="mt-0.5 text-[13px] tabular-nums">
        <span className="font-semibold">{number.format(finished)}</span> of {number.format(goal)}{' '}
        {goal === 1 ? 'book' : 'books'}
      </p>
      <div
        role="progressbar"
        aria-label={`Reading goal for ${year}`}
        aria-valuemin={0}
        aria-valuemax={goal}
        aria-valuenow={Math.min(finished, goal)}
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-hairline"
      >
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${Math.min(100, (finished / goal) * 100)}%` }}
        />
      </div>
      <p className="mt-1 text-[10px] text-ink-faint">{goalStatus(finished, goal, current)}</p>
    </div>
  )
}

function CompletionChart({
  rows,
  period
}: {
  rows: CountedLabel[]
  period: 'month' | 'year'
}): ReactNode {
  const maximum = Math.max(0, ...rows.map((row) => row.count))

  return (
    <div>
      <p className="mb-3 text-[12px] text-ink-muted">Books finished by {period}</p>
      <div className="overflow-x-auto">
        <div style={period === 'year' ? { minWidth: rows.length * 48 } : undefined}>
          <div className="flex h-40 items-end gap-2 border-b border-hairline-strong px-1">
            {rows.map((row) => {
              const height = row.count === 0 ? 0 : Math.max(7, (row.count / maximum) * 128)
              return (
                <div
                  key={row.label}
                  className="flex h-full min-w-0 flex-1 flex-col items-center justify-end"
                  aria-label={`${row.label}: ${row.count} ${row.count === 1 ? 'book' : 'books'}`}
                >
                  {row.count > 0 && (
                    <span className="mb-1 text-[10px] tabular-nums text-ink-muted">
                      {row.count}
                    </span>
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
            {rows.map((row) => (
              <span
                key={row.label}
                className="min-w-0 flex-1 text-center text-[9px] text-ink-faint"
              >
                {period === 'year' ? row.label : row.label.slice(0, 1)}
              </span>
            ))}
          </div>
        </div>
      </div>
      {maximum === 0 && (
        <p className="mt-3 text-center text-[11px] text-ink-faint">
          {period === 'year'
            ? 'No books with completion dates yet.'
            : 'No books with completion dates for the selected year.'}
        </p>
      )}
    </div>
  )
}

function BarList({ rows, total }: { rows: CountedLabel[]; total: number }): ReactNode {
  const maximum = Math.max(0, ...rows.map((row) => row.count))

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="mb-1 flex items-center justify-between text-[12px]">
            <span className="text-ink-muted">{row.label}</span>
            <span className="tabular-nums text-ink-muted">{row.count}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: maximum === 0 ? 0 : `${(row.count / maximum) * 100}%` }}
            />
          </div>
        </div>
      ))}
      {total === 0 && <p className="pt-1 text-center text-[11px] text-ink-faint">No data yet.</p>}
    </div>
  )
}

function RatingHistogram({ rows }: { rows: (CountedLabel & { rating: number })[] }): ReactNode {
  const maximum = Math.max(0, ...rows.map((row) => row.count))

  return (
    <div>
      <div className="flex h-36 items-end gap-1.5 border-b border-hairline-strong px-1">
        {rows.map((row) => {
          const height = row.count === 0 ? 0 : Math.max(7, (row.count / maximum) * 112)
          return (
            <div
              key={row.rating}
              className="flex h-full min-w-0 flex-1 flex-col items-center justify-end"
              aria-label={`${row.label}: ${row.count} ${row.count === 1 ? 'book' : 'books'}`}
            >
              {row.count > 0 && (
                <span className="mb-1 text-[10px] tabular-nums text-ink-muted">{row.count}</span>
              )}
              <span
                className="w-full max-w-8 rounded-t-[2px] bg-star"
                style={{ height }}
                aria-hidden="true"
              />
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex gap-1.5 px-1" aria-hidden="true">
        {rows.map((row) => (
          <span key={row.rating} className="min-w-0 flex-1 text-center text-[10px] text-ink-faint">
            {Number.isInteger(row.rating) ? (
              <>
                {row.rating}
                <span className="text-star">★</span>
              </>
            ) : (
              row.rating
            )}
          </span>
        ))}
      </div>
      {maximum === 0 && (
        <p className="mt-3 text-center text-[11px] text-ink-faint">No rated books yet.</p>
      )}
    </div>
  )
}

function pageCoverage(known: number, total: number): string | undefined {
  if (total === 0 || known === total) return undefined
  return `Based on ${known} of ${total} books with page counts`
}
