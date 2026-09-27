interface Annotation {
  book_id: number
  uuid: string
  type: string
  highlighted_text: string
  notes?: string
  timestamp?: string
}

const NOT_AN_EXPORT =
  'That file is not a Calibre annotations export. In the Calibre viewer, ' +
  'use Highlights, then Export, and keep the calibre format.'

export function parseCollection(raw: string): Annotation[] {
  let parsed: unknown
  try {
    // Calibre writes a byte order mark, which JSON.parse rejects.
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error(NOT_AN_EXPORT)
  }

  const collection = parsed as { type?: unknown; annotations?: unknown }
  if (
    collection?.type !== 'calibre_annotation_collection' ||
    !Array.isArray(collection.annotations)
  )
    throw new Error(NOT_AN_EXPORT)

  return collection.annotations.filter(isImportable)
}

// Bookmarks and removed highlights ride along in the same array.
function isImportable(value: unknown): value is Annotation {
  const annotation = value as Annotation
  return (
    !!annotation &&
    annotation.type === 'highlight' &&
    typeof annotation.uuid === 'string' &&
    annotation.uuid !== '' &&
    Number.isInteger(annotation.book_id) &&
    typeof annotation.highlighted_text === 'string' &&
    annotation.highlighted_text.trim() !== ''
  )
}

export type { Annotation as CalibreAnnotation }
