// Scaled to the shelf. The ceiling is where scores go flat: the top match
// scores ~0.23, the sixtieth ~0.03.
export const MIN_SHOWN = 12
export const MAX_SHOWN = 60
const PER_BOOK = 2

export function shownFor(libraryBooks: number): number {
  return Math.max(MIN_SHOWN, Math.min(MAX_SHOWN, libraryBooks * PER_BOOK))
}
