import { useState, type ReactNode } from 'react'

interface Props {
  value: string
  /** Called with the trimmed text. The caller decides whether to accept it. */
  onCommit: (next: string) => void
  /** Names the field for screen readers, e.g. "Note title". */
  label: string
  /** Shown, faintly, when there is no title yet. */
  placeholder?: string
  /** Tooltip on the resting control. Say what this particular field is. */
  hint?: string
  className?: string
}

// A button rather than a `contenteditable` heading, which the keyboard cannot
// reach and which announces nothing.
export default function EditableTitle({
  value,
  onCommit,
  label,
  placeholder = 'Untitled',
  hint = 'Click to rename',
  className = ''
}: Props): ReactNode {
  const [draft, setDraft] = useState<string | null>(null)

  function commit(): void {
    const next = (draft ?? '').trim()
    setDraft(null)
    if (next !== value) onCommit(next)
  }

  if (draft !== null) {
    return (
      <input
        className={`field ${className}`}
        aria-label={label}
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          // Escape abandons the draft; the stored title is untouched.
          if (event.key === 'Escape') setDraft(null)
          // Otherwise the keystroke would reach the app's global shortcuts.
          event.stopPropagation()
        }}
      />
    )
  }

  return (
    <button
      type="button"
      title={hint}
      onClick={() => setDraft(value)}
      className={`-mx-1 cursor-text truncate rounded px-1 text-left hover:bg-hover ${className} ${
        value ? '' : 'text-ink-faint'
      }`}
    >
      {value || placeholder}
    </button>
  )
}
