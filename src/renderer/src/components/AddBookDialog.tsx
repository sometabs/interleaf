import * as Dialog from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'

import BookSearch from './BookSearch'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function AddBookDialog({ open, onOpenChange }: Props): ReactNode {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay backdrop-blur-[2px]" />
        <Dialog.Content
          onEscapeKeyDown={(event) => event.stopPropagation()}
          className="fixed left-1/2 top-[12vh] z-50 flex max-h-[70vh] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-card border border-hairline bg-surface shadow-pop"
        >
          <Dialog.Title className="sr-only">Add a book</Dialog.Title>
          <Dialog.Description className="sr-only">
            Search Open Library by title, author, or ISBN.
          </Dialog.Description>
          {/* Content unmounts when the dialog closes, so each opening starts a fresh search. */}
          <BookSearch onClose={() => onOpenChange(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
