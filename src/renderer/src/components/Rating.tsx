import { useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'

interface Props {
  value: number | null
  readOnly?: boolean
  onChange?: (value: number | null) => void
}

const STARS = [1, 2, 3, 4, 5]
const LOWEST = 1
const HIGHEST = 5

function Star({ star, shown }: { star: number; shown: number }): ReactNode {
  if (shown >= star) return <span className="text-star">★</span>
  if (shown >= star - 0.5) {
    return (
      <span data-half="" className="relative inline-block text-hairline-strong">
        ★<span className="absolute inset-y-0 left-0 w-1/2 overflow-hidden text-star">★</span>
      </span>
    )
  }
  return <span className="text-hairline-strong">★</span>
}

// The left half of a star picks the half below it; star 1 has no half below.
function pointedAt(star: number, event: MouseEvent<HTMLButtonElement>): number {
  const box = event.currentTarget.getBoundingClientRect()
  const leftHalf = event.clientX < box.left + box.width / 2
  return leftHalf && star > LOWEST ? star - 0.5 : star
}

function ratingLabel(value: number | null): string {
  return value ? `Rated ${value} of 5` : 'Not rated'
}

export default function Rating({ value, readOnly = false, onChange }: Props): ReactNode {
  const [hovered, setHovered] = useState<number | null>(null)
  const shown = hovered ?? value ?? 0

  if (readOnly) {
    return (
      <div role="img" aria-label={ratingLabel(value)} className="inline-flex gap-px leading-none">
        {STARS.map((star) => (
          <span key={star} aria-hidden="true">
            <Star star={star} shown={shown} />
          </span>
        ))}
      </div>
    )
  }

  const step = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const delta =
      event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? 0.5
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? -0.5
          : 0
    if (delta === 0 || (value === null && delta < 0)) return
    event.preventDefault()
    const next = Math.min(HIGHEST, Math.max(LOWEST, (value ?? LOWEST - 0.5) + delta))
    if (next !== value) onChange?.(next)
  }

  return (
    <div
      role="radiogroup"
      aria-label={ratingLabel(value)}
      className="inline-flex gap-px leading-none"
      onMouseLeave={() => setHovered(null)}
    >
      {STARS.map((star) => (
        <button
          key={star}
          type="button"
          aria-label={`${star} star${star > 1 ? 's' : ''}`}
          className="px-0.5 text-[26px] transition-colors hover:opacity-80"
          onMouseMove={(event) => setHovered(pointedAt(star, event))}
          onKeyDown={step}
          onClick={(event) => {
            // A keyboard press has no pointer position, so it picks the whole star.
            const picked = event.detail === 0 ? star : pointedAt(star, event)
            // Clicking the current rating clears it, so there is no separate "remove" control.
            onChange?.(value === picked ? null : picked)
          }}
        >
          <Star star={star} shown={shown} />
        </button>
      ))}
    </div>
  )
}
