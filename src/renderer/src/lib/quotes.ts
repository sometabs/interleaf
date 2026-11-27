import type { Note, NoteKind } from '@shared/api'
import { toPlainText } from '@shared/plaintext'

/** A quote is a note of kind `highlight`, which the schema has always had. */
export const QUOTE_KIND: NoteKind = 'highlight'

export function isQuote(note: Note): boolean {
  return note.kind === QUOTE_KIND
}

// A reader note starts with the passage, quoted; what follows is what was written about it.
export function splitNote(bodyMd: string): { passage: string; thought: string } {
  const lines = bodyMd.split(/\r?\n/)
  let index = 0
  while (index < lines.length && /^\s*>/.test(lines[index])) index++
  return {
    passage: lines.slice(0, index).join('\n'),
    thought: lines.slice(index).join('\n').trim()
  }
}

/** The words a quote or reader note was taken from, as plain text. */
export function passageOf(note: Note): string {
  return toPlainText(isQuote(note) ? note.bodyMd : splitNote(note.bodyMd).passage)
}

function letters(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/** Whether the words at a saved place are still the ones that were saved there. */
export function samePassage(saved: string, found: string): boolean {
  const a = letters(saved)
  const b = letters(found)
  if (!a || a === b) return true
  // Shared start and end leave room for a typo fixed later; another book's words share neither.
  const shorter = Math.min(a.length, b.length)
  let head = 0
  while (head < shorter && a[head] === b[head]) head++
  let tail = 0
  while (tail < shorter - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  return (head + tail) / Math.max(a.length, b.length) >= 0.8
}
