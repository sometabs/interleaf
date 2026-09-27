import type { HighlightImportPlan } from '@shared/api'
import { useState, type ReactNode } from 'react'

import { importSummary } from '../lib/highlights'
import { notify } from '../lib/feedback'
import { useBooks, useImportHighlights } from '../lib/queries'
import { SCREEN_NAMES, useView } from '../lib/view'
import Empty from './Empty'

const NONE = ''

interface Props {
  plan: HighlightImportPlan
}

export default function HighlightImport({ plan }: Props): ReactNode {
  const { navigate, previous, back } = useView()
  const { data: books = [] } = useBooks()
  const runImport = useImportHighlights()
  const sourceName = plan.source === 'kindle' ? 'Kindle' : 'Calibre'

  const [choice, setChoice] = useState<Record<string, string>>(() =>
    Object.fromEntries(plan.books.map((book) => [book.sourceKey, book.bookId?.toString() ?? NONE]))
  )

  const links = plan.books
    .filter((book) => choice[book.sourceKey] !== NONE)
    .map((book) => ({ sourceKey: book.sourceKey, bookId: Number(choice[book.sourceKey]) }))

  const chosen = new Set(links.map((link) => link.sourceKey))
  const total = plan.books
    .filter((book) => chosen.has(book.sourceKey))
    .reduce((sum, book) => sum + book.newHighlights, 0)

  const sorted = [...books].sort((a, b) => a.title.localeCompare(b.title))

  async function onImport(): Promise<void> {
    const result = await runImport.mutateAsync({ filePath: plan.filePath, links })
    notify(importSummary(result))
    navigate({ kind: 'data' })
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-10">
        <div>
          <button
            type="button"
            className="btn btn-ghost -ml-2 mb-4"
            onClick={() => (previous ? back() : navigate({ kind: 'data' }))}
          >
            ← {previous ? SCREEN_NAMES[previous.kind] : 'Data'}
          </button>

          <h1 className="text-[22px] font-semibold tracking-tight">Import highlights</h1>
          <p className="mt-1 text-[13px] text-ink-muted">
            Match each {sourceName} book to a book in your library. Anything left unmatched is
            skipped, and every match is remembered for next time.
          </p>
        </div>

        {plan.books.length === 0 ? (
          <Empty title="No highlights in that file." />
        ) : (
          <div className="flex flex-col gap-2">
            {plan.books.map((book) => (
              <div
                key={book.sourceKey}
                data-testid="import-book"
                className="flex flex-col gap-3 rounded-card border border-hairline bg-surface px-4 py-3"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-[14px]">{book.sourceTitle}</p>
                    {book.sourceAuthor && (
                      <p className="truncate text-[12px] text-ink-muted">{book.sourceAuthor}</p>
                    )}
                  </div>
                  <p className="shrink-0 text-[12px] text-ink-faint">
                    {book.newHighlights} new
                    {book.knownHighlights > 0 && `, ${book.knownHighlights} already imported`}
                  </p>
                </div>

                <ul className="flex flex-col gap-1">
                  {book.samples.map((sample, index) => (
                    <li
                      key={index}
                      className="line-clamp-2 border-l-2 border-hairline pl-3 text-[13px] leading-snug text-ink-muted italic"
                    >
                      {sample}
                    </li>
                  ))}
                </ul>

                <select
                  className="field w-full text-[13px]"
                  aria-label={`Book for ${book.sourceTitle}`}
                  value={choice[book.sourceKey] ?? NONE}
                  onChange={(event) =>
                    setChoice((current) => ({
                      ...current,
                      [book.sourceKey]: event.target.value
                    }))
                  }
                >
                  <option value={NONE}>Skip this one</option>
                  {sorted.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.title}
                      {candidate.author ? ` · ${candidate.author}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}

        {plan.books.length > 0 && (
          <div className="flex items-center justify-end gap-3">
            <p className="text-[13px] text-ink-muted">
              {total === 0 ? 'Nothing selected' : `${total} to import`}
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onImport}
              disabled={links.length === 0 || runImport.isPending}
            >
              {runImport.isPending ? 'Importing…' : 'Import highlights'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
