import type { ReactNode } from 'react'

import { confirm } from '../lib/confirm'
import { useBooks, useDeleteNote, useNote, useUpdateNote } from '../lib/queries'
import { useView } from '../lib/view'
import EditableTitle from './EditableTitle'
import Editor from './Editor'
import Empty from './Empty'

interface Props {
  noteId: number
}

export default function NoteView({ noteId }: Props): ReactNode {
  const { navigate, back } = useView()
  const { data: note, isPending } = useNote(noteId)
  const { data: books = [] } = useBooks()

  const updateNote = useUpdateNote()
  const deleteNote = useDeleteNote()

  if (isPending) return <div className="h-full" />
  if (!note) return <Empty title="This note no longer exists." />

  const owner = note.bookId !== null ? books.find((book) => book.id === note.bookId) : undefined
  // Read here rather than inside `remove`: a hoisted function declaration does
  // not see the null check above it, and the dialog needs the name.
  const name = note.title || 'Untitled'

  async function remove(): Promise<void> {
    const ok = await confirm({
      title: `Delete “${name}”?`,
      body: 'The note and everything written in it will be gone. This cannot be undone.',
      confirmLabel: 'Delete note',
      destructive: true
    })
    if (!ok) return
    deleteNote.mutate(noteId, { onSuccess: () => navigate({ kind: 'notes' }) })
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-8 pt-6 pb-6">
      <div className="mb-4 flex items-center gap-1">
        <button type="button" className="btn btn-ghost -ml-2" onClick={back}>
          ← Back
        </button>

        {/* How a note written outside a book gets tied to one, or moved. */}
        <select
          aria-label="Book this note is about"
          title="Book this note is about"
          value={note.bookId ?? ''}
          onChange={(event) =>
            updateNote.mutate({
              id: noteId,
              patch: { bookId: event.target.value ? Number(event.target.value) : null }
            })
          }
          className="h-7 max-w-56 truncate rounded-control border-none bg-transparent px-1.5 text-[13px] text-ink-muted hover:bg-hover focus:outline-none"
        >
          <option value="">No book</option>
          {books.map((book) => (
            <option key={book.id} value={book.id}>
              {book.title}
            </option>
          ))}
        </select>

        {owner && (
          <button
            type="button"
            className="btn btn-ghost"
            title={`Open ${owner.title}`}
            onClick={() => navigate({ kind: 'book', id: owner.id })}
          >
            Open →
          </button>
        )}

        <span className="flex-1" />
        <button type="button" className="btn btn-ghost btn-danger" onClick={() => void remove()}>
          Delete
        </button>
      </div>

      <h1 className="flex text-[24px]">
        <EditableTitle
          value={note.title}
          label="Note title"
          className="min-w-0 text-[24px] font-semibold"
          onCommit={(title) => updateNote.mutate({ id: noteId, patch: { title } })}
        />
      </h1>

      <div className="card mt-5 min-h-0 flex-1 px-5 py-4">
        <Editor
          key={note.id}
          value={note.bodyMd}
          placeholder="Write freely."
          tag={note.tag}
          onTagChange={(tag) => updateNote.mutate({ id: noteId, patch: { tag } })}
          onSave={(text) => updateNote.mutate({ id: note.id, patch: { bodyMd: text } })}
        />
      </div>
    </div>
  )
}
