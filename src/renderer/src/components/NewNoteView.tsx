import { useState, type ReactNode } from 'react'

import { confirm } from '../lib/confirm'
import { useBooks, useCreateNote } from '../lib/queries'
import { useView } from '../lib/view'
import Editor from './Editor'

export default function NewNoteView(): ReactNode {
  const { back } = useView()
  const { data: books = [] } = useBooks()
  const createNote = useCreateNote()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [bookId, setBookId] = useState<number | null>(null)

  const hasContent = title.trim() !== '' || body.trim() !== ''

  async function leave(): Promise<void> {
    if (!hasContent) {
      back()
      return
    }

    const discard = await confirm({
      title: 'Discard this note?',
      body: 'This draft has not been saved.',
      confirmLabel: 'Discard',
      destructive: true
    })
    if (discard) back()
  }

  function save(): void {
    if (!hasContent) {
      back()
      return
    }

    createNote.mutate(
      {
        kind: 'thought',
        title: title.trim() || undefined,
        bodyMd: body,
        tag,
        bookId
      },
      { onSuccess: back }
    )
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-8 pt-6 pb-6">
      <div className="mb-4 flex items-center gap-2">
        <button type="button" className="btn btn-ghost -ml-2" onClick={() => void leave()}>
          ← Back
        </button>

        <select
          aria-label="Book this note is about"
          title="Book this note is about"
          value={bookId ?? ''}
          onChange={(event) => setBookId(event.target.value ? Number(event.target.value) : null)}
          className="h-7 max-w-56 truncate rounded-control border-none bg-transparent px-1.5 text-[13px] text-ink-muted hover:bg-hover focus:outline-none"
        >
          <option value="">No book</option>
          {books.map((book) => (
            <option key={book.id} value={book.id}>
              {book.title}
            </option>
          ))}
        </select>

        <span className="flex-1" />
        <button
          type="button"
          className="btn btn-primary"
          onClick={save}
          disabled={createNote.isPending}
        >
          {createNote.isPending ? 'Saving…' : 'Done'}
        </button>
      </div>

      <input
        autoFocus
        aria-label="Note title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Untitled note"
        className="field border-transparent bg-transparent px-0 text-[24px] font-semibold hover:border-hairline focus:border-hairline"
      />

      <div className="card mt-5 min-h-0 flex-1 px-5 py-4">
        <Editor
          value=""
          placeholder="Write freely."
          tag={tag}
          onTagChange={setTag}
          onChange={setBody}
          onSave={setBody}
        />
      </div>
    </div>
  )
}
