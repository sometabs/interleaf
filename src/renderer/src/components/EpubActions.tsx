import type { Book } from '@shared/api'
import { useState, type ReactNode } from 'react'

import { confirm } from '../lib/confirm'
import { attachCandidate } from '../lib/epubAttach'
import { fail } from '../lib/feedback'
import {
  useAttachEpub,
  useBookFile,
  useBooks,
  useReadingPosition,
  useRemoveEpub
} from '../lib/queries'
import { useView } from '../lib/view'

export default function EpubActions({ book }: { book: Book }): ReactNode {
  const file = useBookFile(book.id)
  const { data: position } = useReadingPosition(book.id)
  const { data: books = [] } = useBooks()
  const attach = useAttachEpub()
  const remove = useRemoveEpub()
  const { navigate } = useView()
  const [choosing, setChoosing] = useState(false)

  async function choose(): Promise<void> {
    setChoosing(true)
    try {
      const candidate = await window.interleaf.chooseEpub()
      if (candidate) await attachCandidate(book, candidate, books, attach.mutateAsync)
    } catch (error) {
      fail(error)
    } finally {
      setChoosing(false)
    }
  }

  async function detach(): Promise<void> {
    const sure = await confirm({
      title: `Remove the EPUB from “${book.title}”?`,
      body: 'Your quotes and notes stay in the journal.',
      confirmLabel: 'Remove',
      destructive: true
    })
    if (sure) remove.mutate(book.id)
  }

  if (!file) {
    return (
      <div>
        <button
          type="button"
          className="btn btn-outline w-full"
          disabled={choosing}
          onClick={() => void choose()}
        >
          {choosing ? 'Opening…' : 'Attach EPUB'}
        </button>
        <p className="mt-1.5 text-[11px] text-ink-faint">
          Or drag an EPUB file onto the Interleaf window.
        </p>
      </div>
    )
  }

  const progress = position ? Math.round(position.fraction * 100) : 0
  return (
    <div>
      <button
        type="button"
        className="btn btn-primary w-full"
        onClick={() => navigate({ kind: 'reader', bookId: book.id })}
      >
        {progress > 0 ? `Continue reading · ${progress}%` : 'Open book'}
      </button>
      <p className="mt-1.5 flex items-center gap-1 text-[11px] text-ink-faint">
        <span className="min-w-0 truncate" title={file.fileName}>
          {file.fileName}
        </span>
        <span aria-hidden>·</span>
        <button
          type="button"
          className="shrink-0 hover:text-ink"
          disabled={choosing}
          onClick={() => void choose()}
        >
          Replace
        </button>
        <span aria-hidden>·</span>
        <button type="button" className="shrink-0 hover:text-ink" onClick={() => void detach()}>
          Remove
        </button>
      </p>
    </div>
  )
}
