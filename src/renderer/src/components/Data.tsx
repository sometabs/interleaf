import type { ReactNode } from 'react'

import { confirm } from '../lib/confirm'
import { notify } from '../lib/feedback'
import {
  useDataCounts,
  useDeleteAllBooks,
  useDeleteAllNotes,
  useDeleteEverything,
  useDismissed,
  useExportBackup,
  useRestoreBackup,
  useRestoreDismissed
} from '../lib/queries'
import { formatDate } from '../lib/dates'
import Empty from './Empty'

// Counts sit on every button so "Delete all books" reads as "delete these 47".
// Backup is at the top because it is the only undo any of this has.
export default function Data(): ReactNode {
  const { data: counts } = useDataCounts()
  const exportBackup = useExportBackup()
  const restoreBackup = useRestoreBackup()

  const deleteBooks = useDeleteAllBooks()
  const deleteNotes = useDeleteAllNotes()
  const deleteAll = useDeleteEverything()

  const busy = deleteBooks.isPending || deleteNotes.isPending || deleteAll.isPending

  async function onBackup(): Promise<void> {
    // A null result is the folder picker being cancelled, not a failure.
    const result = await exportBackup.mutateAsync()
    if (!result) return
    notify(
      `Backed up ${result.books} books and ${result.notes} notes, ` +
        `with ${result.files} Markdown files, to ${result.dir}`
    )
  }

  async function onRestore(): Promise<void> {
    const ok = await confirm({
      title: 'Restore a backup?',
      body: 'Everything in your library now is replaced by what is in the backup. A copy of the current library is kept beside it. Interleaf restarts once it is done.',
      confirmLabel: 'Choose a backup',
      destructive: true
    })
    if (!ok) return
    // Success never returns here: the app relaunches onto the restored file.
    await restoreBackup.mutateAsync()
  }

  async function onDeleteBooks(): Promise<void> {
    const n = counts?.books ?? 0
    const ok = await confirm({
      title: `Delete all ${n} books?`,
      body: 'Their notes, ratings and metadata go with them. Notes not attached to a book are kept. This cannot be undone.',
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
      body: 'Every note, attached or not. Your books are kept. This cannot be undone.',
      confirmLabel: 'Delete notes',
      destructive: true
    })
    if (!ok) return
    const deleted = await deleteNotes.mutateAsync()
    notify(`Deleted ${deleted} notes`)
  }

  async function onDeleteEverything(): Promise<void> {
    const ok = await confirm({
      title: 'Delete everything?',
      body: 'Books, notes, recommendations and every "Not for me" choice. The app is left as it was on first launch. This cannot be undone.',
      confirmLabel: 'Delete everything',
      destructive: true
    })
    if (!ok) return
    await deleteAll.mutateAsync()
    notify('Everything deleted')
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-8 px-8 py-10">
        <header>
          <h1 className="text-[22px] font-semibold tracking-tight">Data</h1>
        </header>

        <section className="flex flex-col gap-2">
          <h2 className="text-[14px] font-medium">Backup</h2>

          <div className="flex items-center justify-between gap-4 rounded-card border border-hairline bg-surface px-4 py-3">
            <div className="min-w-0">
              <p className="text-[14px]">Back up everything</p>
              <p className="mt-0.5 text-[13px] text-ink-muted">
                Everything, plus a Markdown copy you can read anywhere
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary shrink-0"
              onClick={onBackup}
              disabled={exportBackup.isPending}
            >
              {exportBackup.isPending ? 'Backing up…' : 'Back up'}
            </button>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-card border border-hairline bg-surface px-4 py-3">
            <div className="min-w-0">
              <p className="text-[14px]">Restore a backup</p>
              <p className="mt-0.5 text-[13px] text-ink-muted">
                Replaces your library, then restarts
              </p>
            </div>
            <button
              type="button"
              className="btn btn-outline shrink-0"
              onClick={onRestore}
              disabled={restoreBackup.isPending}
            >
              {restoreBackup.isPending ? 'Restoring…' : 'Restore backup'}
            </button>
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-[14px] font-medium">Delete</h2>

          <Row
            label="All books"
            detail={`${counts?.books ?? 0} books, with their notes and ratings`}
            action="Delete books"
            onAction={onDeleteBooks}
            disabled={busy || (counts?.books ?? 0) === 0}
          />
          <Row
            label="All notes"
            detail={`${counts?.notes ?? 0} notes, attached and free-floating`}
            action="Delete notes"
            onAction={onDeleteNotes}
            disabled={busy || (counts?.notes ?? 0) === 0}
          />
          <Row
            label="Everything"
            detail="Books, notes, recommendations and your Not for me choices"
            action="Delete everything"
            onAction={onDeleteEverything}
            disabled={busy}
          />
        </section>

        <NotForMe />
      </div>
    </div>
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
                {/* A refusal recorded before the name was kept alongside it has
                    only its identifier left; showing that is more honest than
                    showing nothing, since it is still excluding a book. */}
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
