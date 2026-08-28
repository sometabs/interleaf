import { useState, type ReactNode } from 'react'

interface Props {
  value: number | null
  /** Names the field for screen readers, e.g. "Page count". */
  label: string
  /** Shown, faintly, when there is no value yet. */
  placeholder: string
  // Appended when there is a value, such as " pages". Never part of the stored number.
  suffix?: string
  /** Called with the parsed number, or null when the field is emptied. */
  onCommit: (next: number | null) => void
}

// Separate from `EditableTitle` because a title is whatever was typed, while
// "19th century" is not a page count. Unparseable input is refused silently.
export default function EditableNumber({
  value,
  label,
  placeholder,
  suffix = '',
  onCommit
}: Props): ReactNode {
  const [draft, setDraft] = useState<string | null>(null)

  function commit(): void {
    const text = (draft ?? '').trim()
    setDraft(null)

    // Emptying the field is a real intention: it clears the value.
    if (text === '') {
      if (value !== null) onCommit(null)
      return
    }

    const next = Number(text)
    if (!Number.isFinite(next) || next < 0) return
    const rounded = Math.round(next)
    if (rounded !== value) onCommit(rounded)
  }

  if (draft !== null) {
    return (
      <input
        // `inputMode` rather than `type="number"`, whose spinners and
        // scroll-to-change belong on a form, not on a line of text.
        inputMode="numeric"
        className="field w-20 px-1 py-0 text-[12px]"
        aria-label={label}
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
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
      title={`Click to edit the ${label.toLowerCase()}`}
      onClick={() => setDraft(value === null ? '' : String(value))}
      className={`-mx-1 cursor-text rounded px-1 text-left hover:bg-hover ${
        value === null ? 'text-ink-faint' : ''
      }`}
    >
      {value === null ? placeholder : `${value}${suffix}`}
    </button>
  )
}
