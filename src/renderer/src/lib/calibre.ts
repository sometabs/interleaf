import type { CalibreImportResult } from '@shared/api'

export function importSummary(result: CalibreImportResult): string {
  if (result.imported === 0) return 'Nothing new to import'

  const highlights = `${result.imported} ${result.imported === 1 ? 'highlight' : 'highlights'}`
  const books = `${result.books} ${result.books === 1 ? 'book' : 'books'}`
  const already = result.skipped > 0 ? `, ${result.skipped} already there` : ''
  return `Imported ${highlights} into ${books}${already}`
}
