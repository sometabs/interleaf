import type { ReactNode } from 'react'

// Sits on a cover's corner; a light tile so it reads on any jacket.
export default function EpubBadge(): ReactNode {
  return (
    <span
      data-testid="epub-badge"
      title="Readable in Interleaf"
      className="absolute right-1.5 bottom-1.5 grid size-6 place-items-center rounded-control bg-surface/90 text-accent shadow-card"
    >
      <svg
        aria-hidden
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" />
        <path d="M5 17a3 3 0 0 1 3-3h11" />
      </svg>
    </span>
  )
}
