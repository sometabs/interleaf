import type { Book } from '@shared/api'
import type { ReactNode } from 'react'

import { confirm } from '../lib/confirm'
import { useChooseCover, useRemoveCover } from '../lib/queries'
import Cover from './Cover'
import Spinner from './Spinner'

// "Refresh metadata" only fills an empty cover, so a wrong jacket needs this.
// Real buttons, so hover is not the only way to reach them.
export default function CoverPicker({ book }: { book: Book }): ReactNode {
  const choose = useChooseCover()
  const remove = useRemoveCover()
  const busy = choose.isPending || remove.isPending

  async function onRemove(): Promise<void> {
    const ok = await confirm({
      title: 'Remove this cover?',
      body: 'The book keeps everything else, and draws a plain spine instead.',
      confirmLabel: 'Remove cover',
      destructive: true
    })
    if (ok) remove.mutate(book.id)
  }

  return (
    <div className="group relative">
      <Cover title={book.title} author={book.author} path={book.coverPath} size="lg" />

      {busy && (
        <div className="absolute inset-0 grid place-items-center rounded-card bg-ink/30">
          <Spinner label="Updating the cover" />
        </div>
      )}

      {/* `pointer-events-none` on the container with `auto` on the buttons, or the
          overlay swallows clicks meant for the cover. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center gap-1.5 p-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          className="btn btn-primary pointer-events-auto px-2.5 py-1 text-[12px]"
          onClick={() => choose.mutate(book.id)}
          disabled={busy}
        >
          {book.coverPath ? 'Change cover' : 'Add cover'}
        </button>

        {book.coverPath && (
          <button
            type="button"
            className="btn btn-outline pointer-events-auto bg-surface px-2.5 py-1 text-[12px]"
            onClick={onRemove}
            disabled={busy}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  )
}
