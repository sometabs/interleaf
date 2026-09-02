import type { HarvestProgress, RecommendationScope } from '@shared/api'
import { useState, type ReactNode } from 'react'

import { useDiscoverScope } from '../lib/discoverFilters'
import { notify } from '../lib/feedback'
import {
  useBooks,
  useDismissRecommendation,
  useHarvestProgress,
  useRecommendations,
  useRecommendationTree,
  useRefreshRecommendations,
  useSaveRecommendation
} from '../lib/queries'
import { shownFor } from '../lib/shown'
import Cover from './Cover'
import Spinner from './Spinner'
import Empty from './Empty'
import RecommendationTree from './RecommendationTree'

type Layout = 'grid' | 'tree'

/** One question, asked of everybody or of the people already read. */
const SCOPES: readonly { value: RecommendationScope; label: string }[] = [
  { value: 'all', label: 'All authors' },
  { value: 'same-authors', label: 'My authors' }
]

export default function Discover(): ReactNode {
  const [layout, setLayout] = useState<Layout>('grid')
  const [scope, setScope] = useDiscoverScope()

  const { data: books = [] } = useBooks()

  // From the shelf, not this screen, and passed to the recommender rather than
  // trimming the result: a larger limit widens the MMR pool too.
  const query = { scope, limit: shownFor(books.length) }

  const { data: recommendations = [], isPending } = useRecommendations(query)
  const { data: tree = [] } = useRecommendationTree(query)

  const refresh = useRefreshRecommendations()
  const progress = useHarvestProgress(refresh.isPending)
  const dismiss = useDismissRecommendation()
  const save = useSaveRecommendation()

  const ratedHighly = books.filter((book) => (book.rating ?? 0) >= 4).length
  // Scoping to known authors is meaningless when none is recorded, which is
  // common among books added by hand.
  const knownAuthors = books.some((book) => (book.author ?? '').trim() !== '')

  // Which book is being added, not merely that one is: adding fetches metadata
  // and a cover, so only that card should show the work.
  const saving = save.isPending ? save.variables : null

  function saveOne(olid: string): void {
    save.mutate(olid, { onSuccess: (book) => notify(`Added “${book.title}” to your shelf.`) })
  }

  function findMore(): void {
    refresh.mutate(undefined, {
      onSuccess: (result) => {
        if (result.harvested > 0) return
        notify(
          result.offline
            ? 'Could not reach Open Library, so this is what is cached.'
            : 'Rate a few books 4 or 5 stars to get recommendations.'
        )
      }
    })
  }

  return (
    <div className="h-full overflow-y-auto px-8 pt-7 pb-16">
      <header className="mb-6 flex items-start justify-between gap-4">
        <h1 className="text-[22px]">Discover</h1>
        <div className="flex shrink-0 items-center gap-2">
          {/* A way of looking rather than a statement of taste: press it to see
              the other side of the same shelf. */}
          <div
            role="radiogroup"
            aria-label="Authors"
            className="inline-flex rounded-control bg-sunken p-0.5"
          >
            {SCOPES.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={scope === option.value}
                onClick={() => setScope(option.value)}
                className={`rounded-control px-2.5 py-1 text-[12px] transition-colors ${
                  scope === option.value
                    ? 'bg-surface font-medium text-ink shadow-card'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div
            role="group"
            aria-label="Layout"
            className="inline-flex rounded-control bg-sunken p-0.5"
          >
            {(['grid', 'tree'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={layout === option}
                onClick={() => setLayout(option)}
                className={`rounded-control px-2.5 py-1 text-[12px] capitalize transition-colors ${
                  layout === option
                    ? 'bg-surface font-medium text-ink shadow-card'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {option}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="btn btn-outline"
            onClick={findMore}
            disabled={refresh.isPending}
          >
            {refresh.isPending ? 'Searching…' : 'Search'}
          </button>
        </div>
      </header>

      {refresh.isPending && <HarvestProgressPanel progress={progress} />}

      {isPending || (recommendations.length === 0 && refresh.isPending) ? (
        <div className="h-full" />
      ) : recommendations.length === 0 ? (
        <Empty
          title={
            scope !== 'same-authors'
              ? ratedHighly === 0
                ? 'Rate a book 4 or 5 stars to start'
                : 'Nothing to suggest yet'
              : knownAuthors
                ? 'Nothing more by those authors yet'
                : 'No authors on your shelf yet'
          }
        />
      ) : layout === 'tree' ? (
        <RecommendationTree
          roots={tree}
          savingOlid={saving}
          onSave={saveOne}
          onDismiss={(olid) => dismiss.mutate(olid)}
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
          {recommendations.map((rec) => (
            <article key={rec.olid} className="card grid grid-cols-[76px_1fr] gap-4 p-4">
              <Cover title={rec.title} author={rec.author} coverId={rec.coverId} />

              <div className="flex min-w-0 flex-col">
                <h3 className="text-[14px] leading-snug">{rec.title}</h3>
                {rec.author && <p className="text-[12px] text-ink-muted">{rec.author}</p>}

                {rec.becauseOf && (
                  <p className="mt-2 text-[12px] text-ink-muted">
                    Because you liked{' '}
                    <span className="font-medium text-ink">{rec.becauseOf.title}</span>
                  </p>
                )}

                <div className="mt-2 flex flex-wrap gap-1">
                  <span className="chip bg-accent-soft text-[10px] font-medium text-accent">
                    {rec.group}
                  </span>
                  {rec.genres.map((genre) => (
                    <span key={genre} className="chip text-[10px]">
                      {genre}
                    </span>
                  ))}
                </div>

                <div className="mt-auto flex gap-2 pt-3">
                  <button
                    type="button"
                    className="btn btn-primary px-2.5 py-1 text-[12px]"
                    disabled={saving === rec.olid}
                    onClick={() => saveOne(rec.olid)}
                  >
                    {saving === rec.olid && (
                      <Spinner
                        label={`Adding ${rec.title}`}
                        className="size-3.5 border-white/40 border-t-white"
                      />
                    )}
                    {saving === rec.olid ? 'Adding…' : 'Want to read'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost text-[12px]"
                    onClick={() => dismiss.mutate(rec.olid)}
                  >
                    Not for me
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

// Counted steps rather than an animation: an indeterminate stripe is frozen
// solid on a machine that asks for reduced motion.
function HarvestProgressPanel({ progress }: { progress: HarvestProgress | null }): ReactNode {
  const total = progress?.total ?? 0
  const done = progress?.done ?? 0
  const share = total > 0 ? Math.min(done / total, 1) : 0

  return (
    <section
      aria-label="Search progress"
      className="card mb-6 flex flex-col gap-2.5 px-5 py-4"
      data-testid="harvest-progress"
    >
      <div className="flex items-baseline justify-between gap-4">
        <p aria-live="polite" className="min-w-0 truncate text-[13px] text-ink">
          {progress?.label ?? 'Asking Open Library…'}
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
