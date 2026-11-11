import * as Dialog from '@radix-ui/react-dialog'
import type { HarvestProgress, OlBookDto, Recommendation } from '@shared/api'
import type { ReactNode } from 'react'

import { confirm } from '../lib/confirm'
import { notify } from '../lib/feedback'
import { usePersistentState } from '../lib/persistent'
import { useView } from '../lib/view'
import {
  useBooks,
  useDismissRecommendation,
  useHarvestProgress,
  useRecommendations,
  useRecommendationTree,
  useRefreshRecommendations,
  useSaveRecommendation,
  useHybridRecommendationTree,
  useHybridRecommendations,
  useSemanticProgress
} from '../lib/queries'
import { shownFor } from '../lib/shown'
import Cover from './Cover'
import Spinner from './Spinner'
import Empty from './Empty'
import RecommendationTree from './RecommendationTree'

type Layout = 'grid' | 'tree'
const parseBoolean = (raw: unknown): boolean | null => (typeof raw === 'boolean' ? raw : null)
const ADVANCED_RECOMMENDATIONS_DESCRIPTION =
  'Combines keyword matching with AI to find books with similar themes. It runs on your device and uses more RAM while analyzing new books.'

export default function Discover(): ReactNode {
  const [layout, setLayout] = usePersistentState<Layout>(
    'interleaf.recommendationLayout',
    'grid',
    parseLayout
  )
  const [downloadAcknowledged, setDownloadAcknowledged] = usePersistentState(
    'interleaf.advancedDownloadAcknowledged',
    false,
    parseBoolean
  )
  const [hybridDisabled, setHybridDisabled] = usePersistentState(
    'interleaf.hybridDisabled',
    false,
    parseBoolean
  )
  const hybridEnabled = downloadAcknowledged && !hybridDisabled
  const { view, navigate } = useView()

  const { data: books = [] } = useBooks()

  const likeBookId = view.kind === 'discover' ? view.likeBookId : undefined
  const likeBook = books.find((book) => book.id === likeBookId) ?? null

  // From the shelf, not this screen, and passed to the recommender rather than
  // trimming the result: a larger limit widens the MMR pool too.
  const limit = shownFor(books.length)
  const query = likeBook ? { likeBookId: likeBook.id, limit } : { limit }

  const hybridRecommendations = useHybridRecommendations(query, hybridEnabled && layout === 'grid')
  const hybridTree = useHybridRecommendationTree(query, hybridEnabled && layout === 'tree')
  const activeModelQuery = layout === 'tree' ? hybridTree : hybridRecommendations
  const modelFailed = hybridEnabled && activeModelQuery.isError
  const usingModel = hybridEnabled && !modelFailed
  const { data: standardRecommendations = [], isPending: standardPending } = useRecommendations(
    query,
    !usingModel && layout === 'grid'
  )
  const standardTree = useRecommendationTree(query, !usingModel && layout === 'tree')

  const refresh = useRefreshRecommendations()
  const progress = useHarvestProgress(refresh.isPending)
  const dismiss = useDismissRecommendation()
  const save = useSaveRecommendation()
  const modelActive = hybridEnabled && (hybridRecommendations.isFetching || hybridTree.isFetching)
  const semanticProgress = useSemanticProgress(modelActive)
  const recommendations = usingModel ? (hybridRecommendations.data ?? []) : standardRecommendations
  const tree = usingModel ? (hybridTree.data ?? []) : (standardTree.data ?? [])
  const isPending =
    layout === 'tree'
      ? usingModel
        ? hybridTree.isPending
        : standardTree.isPending
      : usingModel
        ? hybridRecommendations.isPending
        : standardPending
  const hasResults = layout === 'tree' ? tree.length > 0 : recommendations.length > 0

  const ratedHighly = books.filter(
    (book) => book.status === 'read' && (book.rating ?? 0) >= 4
  ).length
  // Which book is being added, not merely that one is: adding fetches metadata
  // and a cover, so only that card should show the work.
  const saving = save.isPending ? save.variables.olid : null

  function saveOne(recommendation: Recommendation): void {
    save.mutate(recommendationBook(recommendation), {
      onSuccess: (book) => {
        notify(`Added “${book.title}” to your shelf.`)
      }
    })
  }

  function dismissOne(olid: string): void {
    dismiss.mutate(olid)
  }

  async function toggleAdvancedRecommendations(): Promise<void> {
    if (downloadAcknowledged) {
      setHybridDisabled(hybridEnabled)
      return
    }

    const accepted = await confirm({
      title: 'Turn on advanced recommendations?',
      body: `${ADVANCED_RECOMMENDATIONS_DESCRIPTION} The first run may need an internet connection to download the 35 MB model from Hugging Face.`,
      confirmLabel: 'Turn on',
      cancelLabel: 'Not now'
    })
    if (accepted) {
      setDownloadAcknowledged(true)
      setHybridDisabled(false)
    }
  }

  function findMore(): void {
    refresh.mutate(likeBook ? { likeBookId: likeBook.id } : undefined, {
      onSuccess: (result) => {
        if (result.harvested > 0) return
        notify(
          result.offline
            ? 'Could not reach Open Library, so this is what is cached.'
            : likeBook
              ? 'No new online matches were found for this book.'
              : 'Rate a few books 4 or 5 stars to get recommendations.'
        )
      }
    })
  }

  return (
    <div className="h-full overflow-y-auto px-8 pt-7 pb-16">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div>
          <h1 className="text-[22px]">Discover</h1>
          <p className="mt-1 text-[12px] text-ink-muted">Cached Open Library books</p>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <div className="relative flex items-center">
            <Dialog.Root modal={false}>
              <Dialog.Trigger asChild>
                <button
                  type="button"
                  aria-label="About advanced recommendations"
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-ink-muted hover:bg-hover hover:text-ink"
                >
                  <span className="inline-flex size-4 items-center justify-center rounded-full border border-hairline-strong">
                    ?
                  </span>
                </button>
              </Dialog.Trigger>
              <Dialog.Content
                className="absolute top-full left-0 z-30 mt-2 w-64 rounded-card border border-hairline-strong bg-surface p-3 shadow-pop"
                onEscapeKeyDown={(event) => event.stopPropagation()}
              >
                <Dialog.Title className="sr-only">About advanced recommendations</Dialog.Title>
                <Dialog.Description className="text-[13px] leading-relaxed text-ink-muted">
                  {ADVANCED_RECOMMENDATIONS_DESCRIPTION}
                </Dialog.Description>
              </Dialog.Content>
            </Dialog.Root>

            <button
              type="button"
              role="switch"
              aria-checked={hybridEnabled}
              className="btn btn-ghost gap-2 pl-1 whitespace-nowrap"
              onClick={() => void toggleAdvancedRecommendations()}
            >
              Advanced recommendations
              <span
                aria-hidden="true"
                className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                  hybridEnabled ? 'bg-action' : 'bg-hairline-strong'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-card transition-transform ${
                    hybridEnabled ? 'translate-x-4' : ''
                  }`}
                />
              </span>
            </button>
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
            {refresh.isPending ? 'Searching…' : 'Search online'}
          </button>
        </div>
      </header>

      {likeBook && (
        <section className="mb-6 flex items-center justify-between gap-4 rounded-card border border-hairline bg-surface px-5 py-3">
          <p className="min-w-0 text-[13px] text-ink-muted">
            Books like <span className="font-medium text-ink">{likeBook.title}</span>
            {!refresh.isPending && <span className="ml-1">· cached results</span>}
          </p>
          <button
            type="button"
            className="btn btn-ghost text-[12px]"
            onClick={() => navigate({ kind: 'discover' })}
          >
            Show my whole shelf
          </button>
        </section>
      )}

      {refresh.isPending && <HarvestProgressPanel progress={progress} />}

      {modelActive && semanticProgress && <SemanticProgressPanel progress={semanticProgress} />}

      {modelFailed && (
        <section
          role="status"
          className="card mb-6 flex items-center justify-between gap-4 px-5 py-4"
        >
          <div>
            <p className="text-[13px] text-ink">
              Advanced recommendations are unavailable. Showing keyword results.
            </p>
            <p className="mt-1 text-[12px] text-ink-muted">{activeModelQuery.error?.message}</p>
          </div>
          <button
            type="button"
            className="btn btn-outline shrink-0"
            disabled={activeModelQuery.isFetching}
            onClick={() => void activeModelQuery.refetch()}
          >
            Try again
          </button>
        </section>
      )}

      {isPending || (!hasResults && refresh.isPending) ? (
        <div className="h-full" />
      ) : !hasResults ? (
        <Empty
          title={
            likeBook
              ? `Nothing in the pool resembles ${likeBook.title}`
              : ratedHighly === 0
                ? 'Rate a book 4 or 5 stars to start'
                : 'Nothing to suggest yet'
          }
        />
      ) : layout === 'tree' ? (
        <RecommendationTree
          roots={tree}
          savingOlid={saving}
          onSave={saveOne}
          onDismiss={dismissOne}
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
          {recommendations.map((rec) => (
            <article key={rec.olid} className="card grid grid-cols-[76px_1fr] gap-4 p-4">
              <Cover title={rec.title} author={rec.author} coverId={rec.coverId} />

              <div className="flex min-w-0 flex-col">
                <h3 className="text-[14px] leading-snug">{rec.title}</h3>
                {rec.author && <p className="text-[12px] text-ink-muted">{rec.author}</p>}

                {!likeBook && rec.becauseOf && (
                  <p className="mt-2 text-[12px] text-ink-muted">
                    Because you liked{' '}
                    <span className="font-medium text-ink">{rec.becauseOf.title}</span>
                  </p>
                )}

                <div className="mt-2 flex flex-wrap gap-1">
                  {rec.subjects.slice(0, 3).map((subject, index) => (
                    <span key={`${subject}-${index}`} className="chip text-[10px]">
                      {subject}
                    </span>
                  ))}
                </div>

                <div className="mt-auto flex gap-2 pt-3">
                  <button
                    type="button"
                    className="btn btn-primary px-2.5 py-1 text-[12px]"
                    disabled={saving === rec.olid}
                    onClick={() => saveOne(rec)}
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
                    onClick={() => dismissOne(rec.olid)}
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

function recommendationBook(recommendation: Recommendation): OlBookDto {
  return {
    olid: recommendation.olid,
    editionOlid: recommendation.editionOlid,
    title: recommendation.title,
    author: recommendation.author,
    publishedYear: recommendation.publishedYear,
    coverId: recommendation.coverId,
    isbn: recommendation.isbn,
    pageCount: recommendation.pageCount,
    subjects: [...recommendation.subjects],
    description: recommendation.description
  }
}

function parseLayout(raw: unknown): Layout | null {
  return raw === 'grid' || raw === 'tree' ? raw : null
}

function SemanticProgressPanel({
  progress
}: {
  progress: { done: number; total: number; label: string }
}): ReactNode {
  const share = progress.total > 0 ? Math.min(progress.done / progress.total, 1) : 0
  return (
    <section className="card mb-6 flex flex-col gap-2.5 px-5 py-4" aria-live="polite">
      <div className="flex items-baseline justify-between gap-4">
        <p className="min-w-0 truncate text-[13px] text-ink">{progress.label}</p>
        <p className="shrink-0 text-[12px] tabular-nums text-ink-faint">
          {Math.round(share * 100)}%
        </p>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-sunken">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300"
          style={{ width: `${Math.round(share * 100)}%` }}
        />
      </div>
    </section>
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
