import type { HighlightImportResult } from '@shared/api'

export function importSummary(result: HighlightImportResult): string {
  if (result.imported === 0) return 'Nothing new to import'

  const highlights = `${result.imported} ${result.imported === 1 ? 'highlight' : 'highlights'}`
  const books = `${result.books} ${result.books === 1 ? 'book' : 'books'}`
  const already = result.skipped > 0 ? `; ${result.skipped} skipped` : ''
  return `Imported ${highlights} into ${books}${already}`
}
