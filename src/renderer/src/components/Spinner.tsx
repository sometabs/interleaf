import type { ReactNode } from 'react'

interface Props {
  /** Read out by assistive tech, and the tooltip on hover. */
  label: string
  className?: string
}

// Speed is set in `main.css`, not by Tailwind's `animate-spin`, whose
// one-second turn reads as frantic here.
export default function Spinner({ label, className = '' }: Props): ReactNode {
  return <span role="status" aria-label={label} title={label} className={`spinner ${className}`} />
}
