import type { Recommendation, RecommendationNode } from '@shared/api'
import { useState, type ReactNode } from 'react'

import Cover from './Cover'
import Empty from './Empty'
import Spinner from './Spinner'

interface Props {
  roots: RecommendationNode[]
  // The one book scores were measured against in "Find books like this"; null for your taste.
  rankedAgainst?: string | null
  onSave: (recommendation: Recommendation) => void
  onDismiss: (olid: string) => void
  // The book currently being added, so its node alone shows the work.
  savingOlid: string | null
}

interface Handlers {
  onSave: (recommendation: Recommendation) => void
  onDismiss: (olid: string) => void
  savingOlid: string | null
  rankedAgainst?: string | null
}

function scoreLabel(node: RecommendationNode, rankedAgainst: string | null | undefined): string {
  if (node.scoreKind === 'fusion') return 'ranked by Advanced recommendations'
  return rankedAgainst
    ? `${percent(node.score)} alike to ${rankedAgainst}`
    : `${percent(node.score)} match with your taste`
}

interface Column {
  // The book this column's books are alike to; null for the first column.
  from: RecommendationNode | null
  books: RecommendationNode[]
}

const VISIBLE_COLUMNS = 4

// Click-through columns: choosing a book opens the books like it in the next column, so only
// the path being explored is ever shown and the tree never needs scrolling sideways.
export default function RecommendationTree({
  roots,
  rankedAgainst = null,
  onSave,
  onDismiss,
  savingOlid
}: Props): ReactNode {
  // Olids rather than nodes: the tree is rebuilt after every save or dismissal.
  const [chosen, setChosen] = useState<string[]>([])

  if (roots.length === 0) {
    return <Empty title="Nothing to arrange yet">Recommendations appear here in columns.</Empty>
  }

  const path = resolvePath(roots, chosen)
  const columns: Column[] = [{ from: null, books: roots }]
  for (const node of path) {
    if (node.children.length > 0) columns.push({ from: node, books: node.children })
  }
  const start = Math.max(0, columns.length - VISIBLE_COLUMNS)

  function choose(level: number, node: RecommendationNode): void {
    setChosen([...path.slice(0, level).map((step) => step.olid), node.olid])
  }

  return (
    <div data-testid="tree">
      {start > 0 && (
        <nav
          aria-label="Path so far"
          className="mb-3 flex flex-wrap items-center gap-1 text-[12px]"
        >
          <span className="text-ink-faint">Back to</span>
          {path.slice(0, start).map((step, index) => (
            <button
              key={step.olid}
              type="button"
              className="max-w-48 truncate rounded-control px-1.5 py-0.5 text-ink-muted hover:bg-hover hover:text-ink"
              onClick={() => setChosen(path.slice(0, index + 1).map((node) => node.olid))}
            >
              {step.title}
            </button>
          ))}
        </nav>
      )}

      <div className="grid grid-cols-4 gap-3">
        {columns.slice(start).map((column, offset) => {
          const level = start + offset
          return (
            <section
              key={column.from?.olid ?? 'top'}
              aria-label={column.from ? `Like ${column.from.title}` : 'Closest to your taste'}
              className={`min-w-0 ${offset > 0 ? 'border-l border-hairline pl-3' : ''}`}
            >
              <h2 className="eyebrow mb-2 truncate">
                {column.from ? (
                  <>
                    Like{' '}
                    <span className="font-medium tracking-normal text-ink-muted normal-case">
                      {column.from.title}
                    </span>
                  </>
                ) : (
                  'Closest to your taste'
                )}
              </h2>
              <ul className="space-y-1">
                {column.books.map((node) => (
                  <li key={node.olid}>
                    <NodeRow
                      node={node}
                      parent={column.from}
                      selected={path[level]?.olid === node.olid}
                      onChoose={() => choose(level, node)}
                      rankedAgainst={rankedAgainst}
                      onSave={onSave}
                      onDismiss={onDismiss}
                      savingOlid={savingOlid}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>

      <Details
        node={path[path.length - 1]}
        parent={path.length > 1 ? path[path.length - 2] : null}
        rankedAgainst={rankedAgainst}
        onSave={onSave}
        onDismiss={onDismiss}
        savingOlid={savingOlid}
      />
    </div>
  )
}

// The last book chosen, in full, so a decision can be made without leaving Discover.
function Details({
  node,
  parent,
  rankedAgainst,
  onSave,
  onDismiss,
  savingOlid
}: { node: RecommendationNode; parent: RecommendationNode | null } & Handlers): ReactNode {
  const facts = [node.author, node.publishedYear, node.pageCount && `${node.pageCount} pages`]
    .filter(Boolean)
    .join(' · ')
  const likeness =
    parent && node.similarityToParent !== null
      ? `${percent(node.similarityToParent)} alike to ${parent.title}`
      : 'Top pick'
  const taste = scoreLabel(node, rankedAgainst)
  const saving = savingOlid === node.olid

  return (
    <section
      aria-label={`About ${node.title}`}
      className="mt-6 flex gap-5 border-t border-hairline pt-5"
    >
      <span className="w-28 shrink-0">
        <Cover title={node.title} author={node.author} coverId={node.coverId} size="lg" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[18px] leading-snug font-medium">{node.title}</h2>
        {facts && <p className="mt-0.5 text-[13px] text-ink-muted">{facts}</p>}
        <p className="mt-1.5 text-[12px] text-ink-faint">
          {likeness} · {taste}
        </p>
        {node.description && (
          <p className="mt-3 line-clamp-5 max-w-prose text-[13px] leading-relaxed whitespace-pre-line text-ink-muted">
            {node.description}
          </p>
        )}
        {node.subjects.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {node.subjects.slice(0, 6).map((subject) => (
              <span key={subject} className="chip text-[11px]">
                {subject}
              </span>
            ))}
          </div>
        )}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving}
            onClick={() => onSave(node)}
          >
            {saving ? 'Adding…' : 'Want to read'}
          </button>
          <button type="button" className="btn btn-outline" onClick={() => onDismiss(node.olid)}>
            Not for me
          </button>
        </div>
      </div>
    </section>
  )
}

// The first book is open from the start; a step that vanished after a dismissal ends the path.
function resolvePath(roots: RecommendationNode[], chosen: string[]): RecommendationNode[] {
  const path: RecommendationNode[] = []
  let options = roots
  for (const olid of chosen.length > 0 ? chosen : [roots[0].olid]) {
    const next = options.find((node) => node.olid === olid)
    if (!next) break
    path.push(next)
    options = next.children
  }
  if (path.length === 0) path.push(roots[0])
  return path
}

function NodeRow({
  node,
  parent,
  selected,
  onChoose,
  rankedAgainst,
  onSave,
  onDismiss,
  savingOlid
}: {
  node: RecommendationNode
  parent: RecommendationNode | null
  selected: boolean
  onChoose: () => void
} & Handlers): ReactNode {
  const saving = savingOlid === node.olid
  const label = scoreLabel(node, rankedAgainst)
  const taste = label[0].toUpperCase() + label.slice(1)
  const tooltip = [taste, node.subjects.slice(0, 5).join(' · ')].filter(Boolean).join('\n')
  const opens = node.children.length > 0

  return (
    <article
      data-testid="tree-node"
      data-depth={node.depth}
      title={tooltip}
      className={`group relative flex items-center rounded-control border transition-colors ${
        selected ? 'border-accent/50 bg-accent-soft' : 'border-transparent hover:bg-hover'
      }`}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={onChoose}
        className="flex min-w-0 flex-1 items-start gap-2.5 p-2 text-left"
      >
        <span className="w-8 shrink-0">
          <Cover title={node.title} author={node.author} coverId={node.coverId} size="sm" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[13px] leading-tight font-medium">{node.title}</span>
          {node.author && (
            <span className="block truncate text-[11px] text-ink-muted">{node.author}</span>
          )}
          <span className="mt-1 flex items-center justify-between gap-1.5">
            {node.subjects[0] ? (
              <span className="chip min-w-0 truncate text-[10px]">{node.subjects[0]}</span>
            ) : (
              <span />
            )}
            <span className="flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-ink-faint">
              {parent && node.similarityToParent !== null ? (
                <span title={`How alike it is to ${parent.title}`}>
                  <span data-testid="tree-edge">{percent(node.similarityToParent)}</span> alike
                </span>
              ) : (
                'Top pick'
              )}
              <span aria-hidden="true" className="w-2 text-[13px]">
                {opens ? '›' : ''}
              </span>
            </span>
          </span>
        </span>
      </button>

      <span
        className={`absolute top-1.5 right-1.5 flex items-center gap-1 transition-opacity ${
          saving
            ? 'opacity-100'
            : 'opacity-0 group-has-[:focus-visible]:opacity-100 group-hover:opacity-100'
        }`}
      >
        {saving ? (
          <Spinner label={`Adding ${node.title}`} className="size-4" />
        ) : (
          <IconButton
            label={`Want to read ${node.title}`}
            tooltip="Want to read"
            className="hover:bg-accent-soft hover:text-accent"
            onClick={() => onSave(node)}
          >
            <path d="M8 3.5v9M3.5 8h9" />
          </IconButton>
        )}
        <IconButton
          label={`Not for me: ${node.title}`}
          tooltip="Not for me"
          className="hover:bg-danger-soft hover:text-danger"
          onClick={() => onDismiss(node.olid)}
        >
          <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
        </IconButton>
      </span>
    </article>
  )
}

function IconButton({
  label,
  tooltip,
  className,
  onClick,
  children
}: {
  label: string
  tooltip: string
  className: string
  onClick: () => void
  children: ReactNode
}): ReactNode {
  return (
    <button
      type="button"
      aria-label={label}
      title={tooltip}
      onClick={onClick}
      className={`flex size-6 items-center justify-center rounded-control bg-surface text-ink-faint transition-colors ${className}`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="size-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      >
        {children}
      </svg>
    </button>
  )
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}
