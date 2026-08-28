import type { ReactNode } from 'react'

import { confirm } from '../lib/confirm'
import { notify } from '../lib/feedback'
import {
  useDataCounts,
  useDeleteAllBooks,
  useDeleteAllNotes,
  useDeleteEverything,
  useDismissed,
  useExportVault,
  useImportVault,
  useRestoreDismissed
} from '../lib/queries'
import { formatDate } from '../lib/dates'
import Empty from './Empty'

// Counts sit on every button so "Delete all books" reads as "delete these 47".
// Export is at the top because it is the only undo any of this has.
export default function Data(): ReactNode {
  const { data: counts } = useDataCounts()
  const exportVault = useExportVault()
  const importVault = useImportVault()

  const deleteBooks = useDeleteAllBooks()
  const deleteNotes = useDeleteAllNotes()
  const deleteAll = useDeleteEverything()

  const busy = deleteBooks.isPending || deleteNotes.isPending || deleteAll.isPending

  async function onExport(): Promise<void> {
    // A null result is the folder picker being cancelled, not a failure.
    const result = await exportVault.mutateAsync()
    if (result) notify(`Exported ${result.files} files to ${result.dir}`)
  }

  async function onImport(): Promise<void> {
    // A null result is the folder picker being cancelled, not a failure.
    const result = await importVault.mutateAsync()
    if (!result) return

    // The importer looks for `books/` and `notes/` inside what was picked, so
    // zero and zero means the wrong folder rather than an empty vault.
    if (result.books === 0 && result.notes === 0) {
      notify('Nothing to import. Pick the folder that contains the books and notes folders.')
      return
    }
    notify(`Imported ${result.books} books and ${result.notes} notes`)
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
          <h2 className="text-[14px] font-medium">Export and import</h2>

          {/* Overwrites its folder rather than versioning it, so exporting
              somewhere new leaves the previous copy untouched. */}
          <div className="flex items-center justify-between gap-4 rounded-card border border-hairline bg-surface px-4 py-3">
            <div className="min-w-0">
              <p className="text-[14px]">Export a vault</p>
              <p className="mt-0.5 text-[13px] text-ink-muted">
                Your books and notes as Markdown files you own
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary shrink-0"
              onClick={onExport}
              disabled={exportVault.isPending}
            >
              {exportVault.isPending ? 'Exporting…' : 'Export'}
            </button>
          </div>

          {/* Adds to the library rather than replacing it: the vault importer
              matches on what is already there, so re-importing the same folder
              does not produce a second copy of every book. */}
          <div className="flex items-center justify-between gap-4 rounded-card border border-hairline bg-surface px-4 py-3">
            <div className="min-w-0">
              <p className="text-[14px]">Import a vault</p>
              <p className="mt-0.5 text-[13px] text-ink-muted">
                Adds a folder of Markdown to what you already have
              </p>
            </div>
            <button
              type="button"
              className="btn btn-outline shrink-0"
              onClick={onImport}
              disabled={importVault.isPending}
            >
              {importVault.isPending ? 'Importing…' : 'Import'}
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
