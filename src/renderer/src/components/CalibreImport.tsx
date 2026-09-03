import type { CalibreImportPlan } from '@shared/api'
import { useState, type ReactNode } from 'react'

import { importSummary } from '../lib/calibre'
import { notify } from '../lib/feedback'
import { useBooks, useImportCalibreHighlights } from '../lib/queries'
import { SCREEN_NAMES, useView } from '../lib/view'
import Empty from './Empty'

const NONE = ''

interface Props {
  plan: CalibreImportPlan
}

export default function CalibreImport({ plan }: Props): ReactNode {
  const { navigate, previous, back } = useView()
  const { data: books = [] } = useBooks()
  const runImport = useImportCalibreHighlights()

  const [choice, setChoice] = useState<Record<number, string>>(() =>
    Object.fromEntries(plan.books.map((book) => [book.calibreId, book.bookId?.toString() ?? NONE]))
  )

  const links = plan.books
    .filter((book) => choice[book.calibreId] !== NONE)
    .map((book) => ({ calibreId: book.calibreId, bookId: Number(choice[book.calibreId]) }))

  const chosen = new Set(links.map((link) => link.calibreId))
  const total = plan.books
    .filter((book) => chosen.has(book.calibreId))
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
            Calibre names no books in its export, only numbers. Match each one to a book in your
            library. Anything left unmatched is skipped, and every match is remembered for next
            time.
          </p>
        </div>

        {plan.books.length === 0 ? (
          <Empty title="No highlights in that file." />
        ) : (
          <div className="flex flex-col gap-2">
            {plan.books.map((book) => (
              <div
                key={book.calibreId}
                data-testid="calibre-book"
                className="flex flex-col gap-3 rounded-card border border-hairline bg-surface px-4 py-3"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <p className="text-[14px]">Calibre book {book.calibreId}</p>
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
                  aria-label={`Book for Calibre book ${book.calibreId}`}
                  value={choice[book.calibreId] ?? NONE}
                  onChange={(event) =>
                    setChoice((current) => ({
                      ...current,
                      [book.calibreId]: event.target.value
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
