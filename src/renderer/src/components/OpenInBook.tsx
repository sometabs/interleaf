import type { Note } from '@shared/api'
import type { ReactNode } from 'react'

import { useOpenInBook } from '../lib/queries'

export default function OpenInBook({ note }: { note: Note }): ReactNode {
  const open = useOpenInBook(note)
  if (!open) return null
  return (
    <button type="button" className="btn btn-ghost shrink-0" onClick={open}>
      Open in book
    </button>
  )
}
