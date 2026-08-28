import type { Note, NoteKind } from '@shared/api'

/** A quote is a note of kind `highlight`, which the schema has always had. */
export const QUOTE_KIND: NoteKind = 'highlight'

export function isQuote(note: Note): boolean {
  return note.kind === QUOTE_KIND
}

/** Reviews stay in the Notes list; only quotes leave, having their own screen. */
export function isNotQuote(note: Note): boolean {
  return !isQuote(note)
}
