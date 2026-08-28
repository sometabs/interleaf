import { useState, type ReactNode } from 'react'

interface Props {
  value: number | null
  readOnly?: boolean
  onChange?: (value: number | null) => void
}

const STARS = [1, 2, 3, 4, 5]

export default function Rating({ value, readOnly = false, onChange }: Props): ReactNode {
  const [hovered, setHovered] = useState<number | null>(null)
  const shown = hovered ?? value ?? 0

  if (readOnly) {
    return (
      <div
        role="img"
        aria-label={value ? `Rated ${value} of 5` : 'Not rated'}
        className="inline-flex gap-px leading-none"
      >
        {STARS.map((star) => (
          <span
            key={star}
            aria-hidden="true"
            className={star <= shown ? 'text-star' : 'text-hairline-strong'}
          >
            ★
          </span>
        ))}
      </div>
    )
  }

  return (
    <div
      role="radiogroup"
      aria-label={value ? `Rated ${value} of 5` : 'Not rated'}
      className="inline-flex gap-px leading-none"
      onMouseLeave={() => setHovered(null)}
    >
      {STARS.map((star) => (
        <button
          key={star}
          type="button"
          aria-label={`${star} star${star > 1 ? 's' : ''}`}
          className={`px-px text-[17px] transition-colors ${
            star <= shown ? 'text-star' : 'text-hairline-strong hover:text-star/60'
          }`}
          onMouseEnter={() => setHovered(star)}
          // Clicking the current rating clears it, so there is no separate "remove" control.
          onClick={() => onChange?.(value === star ? null : star)}
        >
          ★
        </button>
      ))}
    </div>
  )
}
