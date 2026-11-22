import * as Dialog from '@radix-ui/react-dialog'
import type { Book, EpubCandidate } from '@shared/api'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { attachCandidate } from '../lib/epubAttach'
import { matchLibrary } from '../lib/epubMatch'
import { fail, notify } from '../lib/feedback'
import { useAttachEpub, useBooks } from '../lib/queries'
import { useView } from '../lib/view'
import BookSearch from './BookSearch'
import Cover from './Cover'
import { useOverlayContainer } from '../lib/overlay'

const isEpub = (file: File): boolean => file.name.toLowerCase().endsWith('.epub')

function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false
}

// Dropping an EPUB anywhere asks which book it belongs to; it never creates one by itself.
export default function EpubDrop(): ReactNode {
  const { data: books = [] } = useBooks()
  const attach = useAttachEpub()
  const { navigate } = useView()
  const [candidate, setCandidate] = useState<EpubCandidate | null>(null)
  const [dropId, setDropId] = useState(0)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    // Enter and leave fire for every element crossed, so only the count says the file left the window.
    let depth = 0
    // A cancelled drag may send no final leave, but it always stops sending dragover.
    let quiet: number | undefined
    const hideSoon = (): void => {
      window.clearTimeout(quiet)
      quiet = window.setTimeout(() => {
        depth = 0
        setDragging(false)
      }, 500)
    }
    const onDragEnter = (event: DragEvent): void => {
      if (!carriesFiles(event)) return
      depth++
      setDragging(true)
      hideSoon()
    }
    const onDragLeave = (event: DragEvent): void => {
      if (!carriesFiles(event)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onDragOver = (event: DragEvent): void => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      hideSoon()
    }
    const onDrop = (event: DragEvent): void => {
      window.clearTimeout(quiet)
      depth = 0
      setDragging(false)
      if (!carriesFiles(event)) return
      event.preventDefault()
      const epubs = [...(event.dataTransfer?.files ?? [])].filter(isEpub)
      if (epubs.length === 0) {
        fail(new Error('Only EPUB files can be dropped here.'))
        return
      }
      if (epubs.length > 1) notify('One EPUB at a time: the first one was used.')
      void window.interleaf
        .inspectEpub(window.interleaf.pathForFile(epubs[0]))
        .then((found) => {
          if (found.bookId !== null) {
            notify('This EPUB is already in your library.')
            navigate({ kind: 'book', id: found.bookId })
            return
          }
          setDropId((id) => id + 1)
          setCandidate(found)
        })
        .catch(fail)
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.clearTimeout(quiet)
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [navigate])

  async function attachTo(book: Book): Promise<void> {
    if (!candidate) return
    const found = candidate
    setCandidate(null)
    try {
      if (await attachCandidate(book, found, books, attach.mutateAsync)) {
        navigate({ kind: 'book', id: book.id })
      }
    } catch (error) {
      fail(error)
    }
  }

  const described = candidate
    ? [candidate.title ?? candidate.fileName, candidate.author].filter(Boolean).join(' · ')
    : ''

  return (
    <>
      {dragging && (
        <div
          role="status"
          className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-overlay p-6 backdrop-blur-[2px]"
        >
          <div className="rounded-card border-2 border-dashed border-accent bg-surface px-10 py-8 text-center shadow-pop">
            <p className="text-[15px] font-medium">Drop to add this EPUB</p>
            <p className="mt-1 text-[13px] text-ink-muted">You choose which book it belongs to.</p>
          </div>
        </div>
      )}
      <BookPicker
        key={dropId}
        candidate={candidate}
        described={described}
        books={books}
        onPick={(book) => void attachTo(book)}
        onClose={() => setCandidate(null)}
      />
    </>
  )
}

// One dialog for both steps: closing one dialog while opening another left the page locked.
function BookPicker({
  candidate,
  described,
  books,
  onPick,
  onClose
}: {
  candidate: EpubCandidate | null
  described: string
  books: Book[]
  onPick: (book: Book) => void
  onClose: () => void
}): ReactNode {
  const container = useOverlayContainer()
  const [searching, setSearching] = useState(false)
  const [filter, setFilter] = useState('')
  const matches = useMemo(
    () => (candidate ? matchLibrary(candidate, books) : { clear: null, close: [] }),
    [candidate, books]
  )
  const rows = useMemo(() => {
    const query = filter.trim().toLowerCase()
    const closeIds = new Set(matches.close.map((book) => book.id))
    const rest = books
      .filter((book) => !closeIds.has(book.id))
      .sort((a, b) => a.title.localeCompare(b.title))
    const ordered = [...matches.close, ...rest].filter((book) => book !== matches.clear)
    return query
      ? ordered.filter((book) => `${book.title} ${book.author ?? ''}`.toLowerCase().includes(query))
      : ordered
  }, [books, filter, matches])
  const clear = matches.clear

  return (
    <Dialog.Root open={candidate !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal container={container}>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay backdrop-blur-[2px]" />
        <Dialog.Content
          // Escape closes this dialog only, not the screen behind it.
          onEscapeKeyDown={(event) => event.stopPropagation()}
          className="fixed left-1/2 top-[12vh] z-50 flex max-h-[72vh] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-card border border-hairline bg-surface shadow-pop"
        >
          {searching ? (
            <>
              <div className="border-b border-hairline px-4 pt-4 pb-3">
                <button
                  type="button"
                  className="btn btn-ghost -ml-2 mb-1 text-[12px]"
                  onClick={() => setSearching(false)}
                >
                  ← Back to your library
                </button>
                <Dialog.Title className="text-[15px] font-medium">
                  Find this book on Open Library
                </Dialog.Title>
                <Dialog.Description className="mt-0.5 truncate text-[13px] text-ink-muted">
                  {described}. The EPUB is attached to the book you pick.
                </Dialog.Description>
              </div>
              <BookSearch
                initialQuery={[candidate?.title?.replace(/\s*[:([].*$/, ''), candidate?.author]
                  .filter(Boolean)
                  .join(' ')}
                onPicked={onPick}
                onClose={onClose}
              />
            </>
          ) : (
            <>
              <div className="border-b border-hairline p-4">
                <Dialog.Title className="text-[15px] font-medium">
                  Which book is this EPUB?
                </Dialog.Title>
                <Dialog.Description className="mt-0.5 truncate text-[13px] text-ink-muted">
                  {described}
                </Dialog.Description>

                {clear && (
                  <div className="mt-3 flex items-center gap-3 rounded-control border border-hairline p-2">
                    <span className="w-8 shrink-0">
                      <Cover
                        title={clear.title}
                        author={clear.author}
                        path={clear.coverPath}
                        size="sm"
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{clear.title}</span>
                      <span className="block truncate text-[12px] text-ink-muted">
                        {clear.author ?? 'Unknown author'}
                      </span>
                    </span>
                    <button
                      type="button"
                      autoFocus
                      className="btn btn-primary shrink-0"
                      onClick={() => onPick(clear)}
                    >
                      Attach to this book
                    </button>
                  </div>
                )}

                <input
                  autoFocus={!clear}
                  className="field mt-3 w-full text-[13px]"
                  placeholder={clear ? 'Or choose another book…' : 'Filter your library…'}
                  aria-label="Filter your library"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                />
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {rows.map((book) => (
                  <button
                    key={book.id}
                    type="button"
                    className="flex w-full items-center gap-3 rounded-control px-2 py-1.5 text-left hover:bg-hover"
                    onClick={() => onPick(book)}
                  >
                    <span className="w-7 shrink-0">
                      <Cover
                        title={book.title}
                        author={book.author}
                        path={book.coverPath}
                        size="sm"
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px]">{book.title}</span>
                      <span className="block truncate text-[11px] text-ink-faint">
                        {book.author ?? 'Unknown author'}
                      </span>
                    </span>
                  </button>
                ))}
                {rows.length === 0 && (
                  <p className="px-4 py-6 text-center text-[13px] text-ink-muted">
                    No book in your library matches.
                  </p>
                )}
              </div>

              <div className="border-t border-hairline p-2">
                <button
                  type="button"
                  className="flex w-full items-center justify-center rounded-control border border-dashed border-hairline-strong px-3 py-2 text-[13px] text-ink-muted hover:bg-hover"
                  onClick={() => setSearching(true)}
                >
                  Add a new book
                </button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
