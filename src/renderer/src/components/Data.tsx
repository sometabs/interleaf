import { useIsMutating } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import type { MetadataRefreshProgress, MetadataRefreshResult } from '@shared/api'

import { importSummary } from '../lib/highlights'
import { confirm } from '../lib/confirm'
import { notify } from '../lib/feedback'
import {
  bulkMetadataRefreshKey,
  useCancelMetadataRefresh,
  useClearRecommendationCache,
  useDataCounts,
  useDeleteAllBooks,
  useDeleteAllQuotes,
  useDeleteAllReviews,
  useDeleteAllThoughts,
  useDeleteEverything,
  useDismissed,
  useBackupStatus,
  useExportBackup,
  useExportMarkdown,
  useSetBackupFolder,
  useImportHighlights,
  useMetadataRefreshProgress,
  useReadHighlightExport,
  useRefreshAllMetadata,
  useRestoreBackup,
  useRestoreDismissed,
  useRetryMetadataRefresh
} from '../lib/queries'
import { formatDate } from '../lib/dates'
import { useView } from '../lib/view'
import Empty from './Empty'

// Counts sit on every button so "Delete all books" reads as "delete these 47".
export default function Data(): ReactNode {
  const { navigate } = useView()
  const { data: counts } = useDataCounts()
  const exportBackup = useExportBackup()
  const restoreBackup = useRestoreBackup()
  const exportMarkdown = useExportMarkdown()
  const { data: backupStatus } = useBackupStatus()
  const setBackupFolder = useSetBackupFolder()
  const readExport = useReadHighlightExport()
  const runImport = useImportHighlights()

  const deleteBooks = useDeleteAllBooks()
  const deleteNotes = useDeleteAllThoughts()
  const deleteQuotes = useDeleteAllQuotes()
  const deleteReviews = useDeleteAllReviews()
  const clearRecommendations = useClearRecommendationCache()
  const deleteAll = useDeleteEverything()

  const busy =
    deleteBooks.isPending ||
    deleteNotes.isPending ||
    deleteQuotes.isPending ||
    deleteReviews.isPending ||
    clearRecommendations.isPending ||
    deleteAll.isPending

  async function onBackup(): Promise<void> {
    // A null result is the folder picker being cancelled, not a failure.
    const result = await exportBackup.mutateAsync()
    if (!result) return
    const epubs = result.epubs > 0 ? ` and ${result.epubs} EPUBs` : ''
    notify(`Backed up ${result.books} books, ${result.notes} notes${epubs} to ${result.dir}`)
  }

  async function onRestore(): Promise<void> {
    const ok = await confirm({
      title: 'Restore a backup?',
      body: 'This replaces your current library with the backup you choose, then restarts Interleaf. Your current library is saved as an automatic backup first.',
      confirmLabel: 'Choose a backup',
      destructive: true
    })
    if (!ok) return
    // Success never returns here: the app relaunches onto the restored file.
    restoreBackup.mutate()
  }

  async function onExportMarkdown(): Promise<void> {
    const result = await exportMarkdown.mutateAsync()
    if (result) notify(`Exported ${result.files} Markdown files to ${result.dir}`)
  }

  // The matching screen is only worth showing when there is something to
  // match: a file of books linked on an earlier import decides nothing.
  async function onImportHighlights(): Promise<void> {
    const plan = await readExport.mutateAsync()
    if (!plan) return

    if (plan.books.length === 0) {
      notify('No highlights in that file')
      return
    }

    if (plan.books.some((book) => book.bookId === null)) {
      navigate({ kind: 'import', plan })
      return
    }

    const links = plan.books.map((book) => ({
      sourceKey: book.sourceKey,
      bookId: book.bookId as number
    }))
    notify(importSummary(await runImport.mutateAsync({ filePath: plan.filePath, links })))
  }

  async function onDeleteBooks(): Promise<void> {
    const n = counts?.books ?? 0
    const ok = await confirm({
      title: `Delete all ${n} books?`,
      body: 'Books and their attached notes, quotes, reviews, ratings and reading data will be deleted. Standalone notes stay. This can’t be undone. Export your library first if you want to keep a copy.',
      confirmLabel: 'Delete books',
      destructive: true
    })
    if (!ok) return
    const deleted = await deleteBooks.mutateAsync()
    notify(`Deleted ${deleted} books`)
  }

  async function onDeleteNotes(): Promise<void> {
    const n = counts?.notes ?? 0
    const ok = await confirm({
      title: `Delete all ${n} notes?`,
      body: 'All ordinary notes, including standalone notes, will be deleted. This can’t be undone. Export your library first if you want to keep a copy.',
      confirmLabel: 'Delete notes',
      destructive: true
    })
    if (!ok) return
    const deleted = await deleteNotes.mutateAsync()
    notify(`Deleted ${deleted} notes`)
  }

  async function onDeleteQuotes(): Promise<void> {
    const n = counts?.quotes ?? 0
    const ok = await confirm({
      title: `Delete all ${n} quotes?`,
      body: 'All saved and imported quotes will be deleted. This can’t be undone. Export your library first if you want to keep a copy.',
      confirmLabel: 'Delete quotes',
      destructive: true
    })
    if (!ok) return
    const deleted = await deleteQuotes.mutateAsync()
    notify(`Deleted ${deleted} quotes`)
  }

  async function onDeleteReviews(): Promise<void> {
    const n = counts?.reviews ?? 0
    const ok = await confirm({
      title: `Delete all ${n} reviews?`,
      body: 'All written reviews will be deleted. This can’t be undone. Export your library first if you want to keep a copy.',
      confirmLabel: 'Delete reviews',
      destructive: true
    })
    if (!ok) return
    const deleted = await deleteReviews.mutateAsync()
    notify(`Deleted ${deleted} reviews`)
  }

  async function onClearRecommendations(): Promise<void> {
    const n = counts?.candidates ?? 0
    const ok = await confirm({
      title: `Clear ${n} cached recommendations?`,
      body: 'Discover will be empty until you search online again. Your library and Not for me choices are kept.',
      confirmLabel: 'Clear cache',
      destructive: true
    })
    if (!ok) return
    const deleted = await clearRecommendations.mutateAsync()
    notify(`Cleared ${deleted} cached recommendations`)
  }

  async function onDeleteEverything(): Promise<void> {
    const ok = await confirm({
      title: 'Delete all library data?',
      body: 'Books, notes, quotes, reviews, recommendations and every "Not for me" choice will be deleted. This can’t be undone. Export your library first if you want to keep a copy.',
      confirmLabel: 'Delete everything',
      destructive: true
    })
    if (!ok) return
    await deleteAll.mutateAsync()
    notify('Library data deleted')
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-8 px-8 py-10">
        <header>
          <h1 className="text-[22px] font-semibold tracking-tight">Data</h1>
        </header>

        <section className="flex flex-col gap-2">
          <h2 className="text-[14px] font-medium">Backups</h2>

          <div className="divide-y divide-hairline rounded-card border border-hairline bg-surface">
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="text-[14px]">Back up library</p>
                <p className="mt-0.5 text-[13px] text-ink-muted">
                  A complete copy you can restore from, on this computer or a new one. Includes your
                  EPUBs.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-primary shrink-0"
                onClick={() => void onBackup()}
                disabled={exportBackup.isPending || restoreBackup.isPending}
              >
                {exportBackup.isPending ? 'Backing up…' : 'Back up…'}
              </button>
            </div>

            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="text-[14px]">Restore from backup</p>
                <p className="mt-0.5 text-[13px] text-ink-muted">
                  Replaces this library with a backup. Your current library is saved first.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-outline shrink-0"
                onClick={() => void onRestore()}
                disabled={restoreBackup.isPending || exportBackup.isPending}
              >
                {restoreBackup.isPending ? 'Restoring…' : 'Restore…'}
              </button>
            </div>

            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="text-[14px]">Automatic backups</p>
                <p className="mt-0.5 text-[13px] text-ink-muted">
                  Daily, last 3 kept.
                  {backupStatus?.latestAt
                    ? ` Last one ${formatDateTime(backupStatus.latestAt)}.`
                    : ' None yet.'}
                </p>
                {backupStatus && (
                  <p
                    className="mt-0.5 truncate text-[12px] text-ink-faint"
                    title={backupStatus.folder}
                  >
                    {backupStatus.folder}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5">
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={setBackupFolder.isPending}
                  onClick={() => setBackupFolder.mutate('choose')}
                >
                  Change folder…
                </button>
                {backupStatus && !backupStatus.isDefault && (
                  <button
                    type="button"
                    className="btn btn-ghost -mr-2 text-[12px]"
                    disabled={setBackupFolder.isPending}
                    onClick={() => setBackupFolder.mutate('default')}
                  >
                    Use default folder
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-[14px] font-medium">Export</h2>

          <div className="flex items-center justify-between gap-4 rounded-card border border-hairline bg-surface px-4 py-3">
            <div className="min-w-0">
              <p className="text-[14px]">Export as Markdown</p>
              <p className="mt-0.5 text-[13px] text-ink-muted">
                Readable copies of your reviews, quotes and notes for other apps, like Obsidian.
                Interleaf can&apos;t restore from these.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-outline shrink-0"
              onClick={() => void onExportMarkdown()}
              disabled={exportMarkdown.isPending}
            >
              {exportMarkdown.isPending ? 'Exporting…' : 'Export…'}
            </button>
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-[14px] font-medium">Import highlights</h2>

          <div className="flex items-center justify-between gap-4 rounded-card border border-hairline bg-surface px-4 py-3">
            <div className="min-w-0">
              <p className="text-[14px]">Highlights from Calibre or Kindle</p>
              <p className="mt-0.5 text-[13px] text-ink-muted">
                A Calibre annotations export or Kindle My Clippings file
              </p>
            </div>
            <button
              type="button"
              className="btn btn-outline shrink-0"
              onClick={onImportHighlights}
              disabled={readExport.isPending || runImport.isPending}
            >
              {readExport.isPending || runImport.isPending ? 'Reading…' : 'Choose file'}
            </button>
          </div>

          <details className="rounded-card border border-hairline bg-surface px-4 py-3">
            <summary className="cursor-pointer text-[13px] text-ink-muted marker:text-ink-faint">
              Where do I get that file?
            </summary>

            <div className="mt-3 flex flex-col gap-2 text-[13px] text-ink-muted">
              <p>
                <span className="text-ink">In Calibre:</span> View → Browse annotations → select the
                annotations you want → Export all selected → choose the type “Calibre annotation
                collection”.
              </p>
              <p>
                <span className="text-ink">On Kindle:</span> Connect it to your computer and choose
                the “My Clippings.txt” file from its documents folder.
              </p>
              <p>
                <span className="text-ink">Here:</span> Choose the file, then match each source book
                to a book in your library. Matches are remembered for later imports.
              </p>
            </div>
          </details>
        </section>

        <MetadataMaintenance bookCount={counts?.books ?? 0} />

        <section className="flex flex-col gap-2">
          <div>
            <h2 className="text-[14px] font-medium">Delete library data</h2>
            <p className="mt-0.5 text-[13px] text-ink-muted">
              Delete one book, note or quote from its own screen. These actions remove whole
              categories.
            </p>
          </div>

          <Row
            label="All books"
            detail={`${counts?.books ?? 0} books, with their notes, quotes, reviews and reading data`}
            action="Delete books"
            onAction={onDeleteBooks}
            disabled={busy || (counts?.books ?? 0) === 0}
          />
          <Row
            label="All notes"
            detail={`${counts?.notes ?? 0} ordinary notes, attached and free-floating`}
            action="Delete notes"
            onAction={onDeleteNotes}
            disabled={busy || (counts?.notes ?? 0) === 0}
          />
          <Row
            label="All quotes"
            detail={`${counts?.quotes ?? 0} saved and imported quotes`}
            action="Delete quotes"
            onAction={onDeleteQuotes}
            disabled={busy || (counts?.quotes ?? 0) === 0}
          />
          <Row
            label="All reviews"
            detail={`${counts?.reviews ?? 0} book reviews`}
            action="Delete reviews"
            onAction={onDeleteReviews}
            disabled={busy || (counts?.reviews ?? 0) === 0}
          />
          <Row
            label="All library data"
            detail="Books, notes, quotes, reviews, recommendations and Not for me choices"
            action="Delete everything"
            onAction={onDeleteEverything}
            disabled={
              busy ||
              ((counts?.books ?? 0) === 0 &&
                (counts?.notes ?? 0) === 0 &&
                (counts?.quotes ?? 0) === 0 &&
                (counts?.reviews ?? 0) === 0 &&
                (counts?.candidates ?? 0) === 0 &&
                (counts?.dismissed ?? 0) === 0)
            }
          />
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-[14px] font-medium">Generated and downloaded data</h2>

          <Row
            label="Recommendation cache"
            detail={`${counts?.candidates ?? 0} books fetched for Discover`}
            action="Clear cache"
            onAction={onClearRecommendations}
            disabled={busy || (counts?.candidates ?? 0) === 0}
          />
        </section>

        <NotForMe />
      </div>
    </div>
  )
}

function MetadataMaintenance({ bookCount }: { bookCount: number }): ReactNode {
  const refresh = useRefreshAllMetadata()
  const retry = useRetryMetadataRefresh()
  const cancel = useCancelMetadataRefresh()
  const refreshing = useIsMutating({ mutationKey: bulkMetadataRefreshKey }) > 0
  const progress = useMetadataRefreshProgress(refreshing)
  const [result, setResult] = useState<MetadataRefreshResult | null>(null)
  const [stopRequested, setStopRequested] = useState(false)

  function finish(next: MetadataRefreshResult): void {
    setResult(next)
    if (!next.cancelled && !next.offline && next.failures.length === 0) {
      notify(`Refreshed metadata for ${next.refreshed} ${next.refreshed === 1 ? 'book' : 'books'}.`)
    }
  }

  async function start(): Promise<void> {
    const ok = await confirm({
      title: `Refresh metadata for all ${bookCount} books?`,
      body: 'Interleaf checks books with an Open Library Work ID one at a time, using up to two requests per book.',
      confirmLabel: 'Refresh all'
    })
    if (!ok) return
    setResult(null)
    setStopRequested(false)
    refresh.mutate(undefined, { onSuccess: finish })
  }

  return (
    <section className="flex flex-col gap-2" aria-label="Book metadata">
      <h2 className="text-[14px] font-medium">Book metadata</h2>
      <div className="flex items-center justify-between gap-4 rounded-card border border-hairline bg-surface px-4 py-3">
        <p className="text-[13px] text-ink-muted">
          Update subjects and descriptions and fill missing book details from Open Library.
        </p>
        {refreshing ? (
          <button
            type="button"
            className="btn btn-outline shrink-0"
            disabled={stopRequested || cancel.isPending}
            onClick={() => {
              setStopRequested(true)
              cancel.mutate(undefined, { onError: () => setStopRequested(false) })
            }}
          >
            {stopRequested ? 'Stopping…' : 'Cancel refresh'}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-outline shrink-0"
            onClick={() => void start()}
            disabled={bookCount === 0}
          >
            Refresh all metadata
          </button>
        )}
      </div>
      {refreshing && <MetadataProgressPanel progress={progress} />}
      {!refreshing &&
        result &&
        (result.cancelled || result.offline || result.failures.length > 0) && (
          <MetadataRefreshSummary
            result={result}
            onRetry={() => {
              setResult(null)
              setStopRequested(false)
              retry.mutate(
                result.failures.map(({ bookId }) => bookId),
                { onSuccess: finish }
              )
            }}
          />
        )}
    </section>
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
    <section aria-label="Metadata refresh progress" className="card px-5 py-4">
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
    <section aria-label="Metadata refresh summary" className="card px-5 py-4 text-[13px]">
      <p className="text-ink">
        {result.cancelled
          ? `Refresh stopped after ${refreshedBooks}.`
          : result.offline
            ? `Refresh paused because Open Library became unreachable. ${refreshedBooks} refreshed.`
            : `${refreshedBooks} refreshed. ${result.failures.length} could not be matched.`}
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
                  <span className="font-medium text-ink">{failure.title}</span> · {failure.reason}
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

function Row({
  label,
  detail,
  action,
  onAction,
  disabled
}: {
  label: string
  detail: string
  action: string
  onAction: () => void
  disabled: boolean
}): ReactNode {
  return (
    <div className="flex items-center justify-between gap-4 rounded-card border border-hairline bg-surface px-4 py-3">
      <div className="min-w-0">
        <p className="text-[14px]">{label}</p>
        <p className="mt-0.5 truncate text-[13px] text-ink-muted">{detail}</p>
      </div>
      <button
        type="button"
        className="btn btn-destructive shrink-0"
        onClick={onAction}
        disabled={disabled}
      >
        {action}
      </button>
    </div>
  )
}

// Otherwise invisible and permanent: a book refused once never appears again.
function NotForMe(): ReactNode {
  const { data: dismissed = [] } = useDismissed()
  const restore = useRestoreDismissed()

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[14px] font-medium">
        Not for me
        {dismissed.length > 0 && (
          <span className="ml-2 text-[13px] font-normal text-ink-faint">{dismissed.length}</span>
        )}
      </h2>

      {dismissed.length === 0 ? (
        <Empty title="Nothing turned down yet." />
      ) : (
        <ul className="flex flex-col gap-1">
          {dismissed.map((book) => (
            <li
              key={book.olid}
              className="flex items-center justify-between gap-4 rounded-card border border-hairline bg-surface px-4 py-2.5"
            >
              <div className="min-w-0">
                {/* A refusal recorded before the name was kept has only its identifier
                    left, and it is still excluding a book. */}
                <p className="truncate text-[14px]">
                  {book.title ?? <span className="text-ink-faint">Unnamed ({book.olid})</span>}
                </p>
                <p className="mt-0.5 truncate text-[13px] text-ink-muted">
                  {[book.author, formatDate(book.at)].filter(Boolean).join(' · ')}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost shrink-0"
                onClick={() => restore.mutate(book.olid)}
                disabled={restore.isPending}
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
}
