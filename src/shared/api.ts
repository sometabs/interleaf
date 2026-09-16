// The IPC surface. Main and preload both import it, so a signature change is a
// compile error rather than a runtime mismatch.

export type BookStatus = 'want' | 'reading' | 'read' | 'abandoned'
export type NoteKind = 'review' | 'thought' | 'highlight'

export const BOOK_STATUSES: readonly BookStatus[] = ['reading', 'want', 'read', 'abandoned']

export const STATUS_LABELS: Record<BookStatus, string> = {
  reading: 'Reading',
  want: 'Want to read',
  read: 'Read',
  abandoned: 'Set aside'
}

export interface Book {
  id: number
  title: string
  author: string | null
  isbn: string | null
  // The Open Library edition whose title, cover and ISBN were selected.
  editionOlid: string | null
  olid: string | null
  coverPath: string | null
  pageCount: number | null
  publishedYear: number | null
  status: BookStatus
  rating: number | null
  startedAt: number | null
  finishedAt: number | null
  // Its place in the reading queue; null outside Want to read.
  priorityPosition: number | null
  // Reader-chosen filing labels. Null means no choice has been made.
  genres: string[] | null
  createdAt: number
  updatedAt: number
}

export interface NewBook {
  title: string
  author?: string | null
  isbn?: string | null
  editionOlid?: string | null
  olid?: string | null
  pageCount?: number | null
  publishedYear?: number | null
  status?: BookStatus
  rating?: number | null
}

export type BookPatch = Partial<Omit<Book, 'id' | 'createdAt' | 'updatedAt' | 'priorityPosition'>>

export interface Note {
  id: number
  bookId: number | null
  kind: NoteKind
  title: string
  bodyMd: string
  createdAt: number
  updatedAt: number
  // One label from `NOTE_TAGS`, or null.
  tag: string | null
}

export interface NewNote {
  bookId?: number | null
  kind?: NoteKind
  title?: string
  bodyMd?: string
  tag?: string | null
  // Unix seconds. Importers pass the date the passage was written down;
  // everything else lets the schema default to now.
  createdAt?: number
}

export interface NotePatch {
  bookId?: number | null
  kind?: NoteKind
  title?: string
  bodyMd?: string
  tag?: string | null
}

// Control characters rather than HTML, so the renderer can split on them
// without injecting markup from note content.
export const HL_START = String.fromCharCode(2)
export const HL_END = String.fromCharCode(3)

export interface SearchHit {
  kind: 'note' | 'book'
  id: number
  title: string
  // Author for a book, owning book title for a note.
  subtitle: string | null
  snippet: string
}

export interface OlBookDto {
  // `olid` is the work; this optional id pins the displayed edition.
  olid: string
  editionOlid?: string | null
  title: string
  author: string | null
  publishedYear: number | null
  coverId: number | null
  isbn: string | null
  pageCount: number | null
  // Search metadata is already in hand. Keeping it avoids replacing a rich
  // search result with a sparse work record when the book is saved.
  subjects?: string[]
  description?: string | null
}

export interface BookMetadata {
  subjects: string[]
  description: string | null
  fetchedAt: number
}

// `all` resembles the shelf as a whole; `same-authors` narrows it to writers
// already read.
export type RecommendationScope = 'all' | 'same-authors'

export interface RecommendationQuery {
  limit?: number
  scope?: RecommendationScope
  // Ranks against this one book instead of the whole shelf. The pool is still
  // the one harvested for the shelf, so an outlier has little to match.
  likeBookId?: number
}

export interface RecommendationRefreshQuery {
  // When set, Open Library is searched for this book rather than the shelf profile.
  likeBookId?: number
}

export interface Recommendation {
  olid: string
  title: string
  author: string | null
  coverId: number | null
  // Cosine similarity to the taste profile; higher is closer.
  score: number
  // The library book this most resembles.
  becauseOf: { bookId: number; title: string } | null
  // Preserved Open Library subjects. The renderer may show a compact subset,
  // but the recommendation carries the original list.
  subjects: string[]
}

// Depth is distance: each level hangs off whichever nearer book it resembles.
export interface RecommendationNode extends Recommendation {
  // Null at a root, which has no parent.
  similarityToParent: number | null
  depth: number
  children: RecommendationNode[]
}

export interface SemanticProgress {
  phase: 'model' | 'embedding' | 'ranking'
  done: number
  total: number
  label: string
}

export interface HarvestResult {
  harvested: number
  offline: boolean
}

// `total` starts as an upper bound and only shrinks, so the bar never retreats.
export interface HarvestProgress {
  done: number
  total: number
  label: string
}

export interface MetadataRefreshProgress {
  done: number
  total: number
  label: string
}

export interface MetadataRefreshFailure {
  bookId: number
  title: string
  reason: string
}

export interface MetadataRefreshResult {
  refreshed: number
  failures: MetadataRefreshFailure[]
  cancelled: boolean
  offline: boolean
}

// The one channel that pushes rather than answers, so it is not part of
// `InterleafApi`.
export const HARVEST_PROGRESS_CHANNEL = 'harvest:progress'
export const METADATA_REFRESH_PROGRESS_CHANNEL = 'metadata-refresh:progress'
export const SEMANTIC_PROGRESS_CHANNEL = 'semantic:progress'

export interface BackupResult {
  dir: string
  books: number
  notes: number
  covers: number
  files: number
}

export interface RestoreResult {
  books: number
  notes: number
  covers: number
  // The copy taken of the library that was replaced, if there was one.
  replaced: string | null
}

// ------------------------------------------------------- Calibre highlights

// One Calibre book in an export. The export names no titles, so an unmatched
// book is recognised by its passages.
export interface CalibreBookPlan {
  calibreId: number
  // The library book this Calibre id was matched to on an earlier import.
  bookId: number | null
  newHighlights: number
  knownHighlights: number
  samples: string[]
}

export interface CalibreImportPlan {
  filePath: string
  books: CalibreBookPlan[]
}

export interface CalibreLink {
  calibreId: number
  bookId: number
}

export interface CalibreImportResult {
  imported: number
  skipped: number
  // How many library books gained highlights.
  books: number
}

export interface DismissedBook {
  olid: string
  // Null for a refusal recorded before the name was kept alongside it.
  title: string | null
  author: string | null
  at: number
}

export interface DataCounts {
  books: number
  notes: number
  candidates: number
  dismissed: number
}

// Every method is async because it crosses IPC, though better-sqlite3 itself
// is synchronous.
export interface InterleafApi {
  listBooks(): Promise<Book[]>
  createBook(input: NewBook): Promise<Book>
  updateBook(id: number, patch: BookPatch): Promise<Book | null>
  reorderPriority(bookIds: number[]): Promise<void>
  deleteBook(id: number): Promise<void>

  listNotes(bookId?: number | null): Promise<Note[]>
  getNote(id: number): Promise<Note | null>
  createNote(input: NewNote): Promise<Note>
  updateNote(id: number, patch: NotePatch): Promise<Note | null>
  deleteNote(id: number): Promise<void>

  search(query: string, limit?: number): Promise<SearchHit[]>

  // Returns [] when offline rather than throwing.
  searchOpenLibrary(query: string): Promise<OlBookDto[]>
  // Takes the whole result: an OLID alone cannot be looked up.
  addBookFromOpenLibrary(book: OlBookDto): Promise<Book>
  enrichBook(bookId: number): Promise<Book | null>
  refreshAllMetadata(): Promise<MetadataRefreshResult>
  retryMetadataRefresh(bookIds: number[]): Promise<MetadataRefreshResult>
  cancelMetadataRefresh(): Promise<void>
  // Null when the picker was cancelled.
  chooseCover(bookId: number): Promise<Book | null>
  removeCover(bookId: number): Promise<Book | null>
  getBookMetadata(bookId: number): Promise<BookMetadata | null>
  refreshRecommendations(query?: RecommendationRefreshQuery): Promise<HarvestResult>
  getRecommendations(query?: RecommendationQuery): Promise<Recommendation[]>
  getSemanticRecommendations(query?: RecommendationQuery): Promise<Recommendation[]>
  // Returns the roots.
  getRecommendationTree(query?: RecommendationQuery): Promise<RecommendationNode[]>
  getSemanticRecommendationTree(query?: RecommendationQuery): Promise<RecommendationNode[]>
  dismissRecommendation(olid: string): Promise<void>
  saveRecommendation(olid: string): Promise<Book>

  exportBackup(): Promise<BackupResult | null>
  // Replaces the whole library, so the app relaunches onto the restored file.
  restoreBackup(): Promise<RestoreResult | null>

  listDismissed(): Promise<DismissedBook[]>
  restoreDismissed(olid: string): Promise<void>

  // Null when the file picker was cancelled. Reads the export, changes nothing.
  readCalibreExport(): Promise<CalibreImportPlan | null>
  // The links are remembered, so a later export of the same books needs none.
  importCalibreHighlights(filePath: string, links: CalibreLink[]): Promise<CalibreImportResult>

  dataCounts(): Promise<DataCounts>
  // Notes not attached to a book survive.
  deleteAllBooks(): Promise<number>
  deleteAllNotes(): Promise<number>
  deleteEverything(): Promise<void>
}

// Subscriptions are kept apart from the request/response surface so main
// implements no listener registry.
export interface InterleafBridge extends InterleafApi {
  // Returns the unsubscribe function.
  onHarvestProgress(listener: (progress: HarvestProgress) => void): () => void
  onMetadataRefreshProgress(listener: (progress: MetadataRefreshProgress) => void): () => void
  onSemanticProgress(listener: (progress: SemanticProgress) => void): () => void
}

// Derived from the interface so the two cannot drift.
export const IPC_CHANNELS = [
  'listBooks',
  'createBook',
  'updateBook',
  'reorderPriority',
  'deleteBook',
  'listNotes',
  'getNote',
  'createNote',
  'updateNote',
  'deleteNote',
  'search',
  'searchOpenLibrary',
  'addBookFromOpenLibrary',
  'enrichBook',
  'refreshAllMetadata',
  'retryMetadataRefresh',
  'cancelMetadataRefresh',
  'chooseCover',
  'removeCover',
  'getBookMetadata',
  'refreshRecommendations',
  'getRecommendations',
  'getSemanticRecommendations',
  'getRecommendationTree',
  'getSemanticRecommendationTree',
  'dismissRecommendation',
  'saveRecommendation',
  'exportBackup',
  'restoreBackup',
  'listDismissed',
  'restoreDismissed',
  'readCalibreExport',
  'importCalibreHighlights',
  'dataCounts',
  'deleteAllBooks',
  'deleteAllNotes',
  'deleteEverything'
] as const satisfies readonly (keyof InterleafApi)[]
