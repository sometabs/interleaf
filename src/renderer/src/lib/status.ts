import type { BookPatch, BookStatus } from '@shared/api'

// Deliberately does not stamp `startedAt` or `finishedAt`: a guessed date is
// indistinguishable from a real one.
export function statusPatch(status: BookStatus): BookPatch {
  return { status }
}
