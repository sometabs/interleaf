import type { Note } from '@shared/api'
import { toPlainText } from '@shared/plaintext'
import type { ReactNode } from 'react'

import { relativeDate } from '../lib/dates'
import Editor from './Editor'

interface Props {
  quote: Note
  open: boolean
  onToggle: () => void
  onSave: (text: string) => void
  onDelete: () => void
  // Where the quote came from: a book name, or a control for choosing one.
  source?: ReactNode
}

// The quotation is the row: a quote has no title worth inventing. Opens in
// place because quotes are read in a run.
export default function QuoteCard({
  quote,
  open,
  onToggle,
  onSave,
  onDelete,
  source
}: Props): ReactNode {
  const text = quote.bodyMd.trim() ? toPlainText(quote.bodyMd) : ''

  if (!open) {
    return (
      <div data-testid="quote-card" className="card overflow-hidden">
        <button
          type="button"
          data-testid="quote-body"
          onClick={onToggle}
          className="flex w-full flex-col gap-2 px-5 py-4 text-left hover:bg-hover"
        >
          {/* `wrap-anywhere` and `min-w-0`, both needed and for different
              reasons: a passage pasted without spaces is one unbreakable word,
              which neither wraps nor lets its flex parent shrink, so it runs
              out of the card and off the screen. Clamped as well, because a
              quote can be a page long and a list of them is meant to be
              skimmed: the whole passage is one click away. */}
          <span
            className={`line-clamp-6 min-w-0 wrap-anywhere border-l-2 border-hairline-strong pl-4 text-[15px] leading-relaxed ${
              text ? 'text-ink' : 'italic text-ink-faint'
            }`}
          >
            {text ? `“${text}”` : 'Empty quote'}
          </span>

          <span className="flex items-baseline justify-between gap-3 pl-4 text-[11px] text-ink-faint">
            <span className="truncate">{source}</span>
            <span className="shrink-0">{relativeDate(quote.updatedAt)}</span>
          </span>
        </button>
      </div>
    )
  }

  return (
    <div data-testid="quote-card" data-open="true" className="card">
      <div className="min-h-32 px-5 py-4">
        <Editor value={quote.bodyMd} placeholder="Type the passage." onSave={onSave} />
      </div>

      <div className="flex items-center gap-2 border-t border-hairline px-3 py-2">
        <span className="min-w-0 flex-1 text-[12px] text-ink-muted">{source}</span>
        <button
          type="button"
          data-testid="quote-done"
          className="btn btn-ghost shrink-0"
          onClick={onToggle}
        >
          Done
        </button>
        <button type="button" className="btn btn-ghost btn-danger shrink-0" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  )
}
