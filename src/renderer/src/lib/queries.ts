import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'

import { useEffect, useState } from 'react'

import type {
  Book,
  InterleafBridge,
  BookMetadata,
  BookPatch,
  BookSubjects,
  DataCounts,
  DismissedBook,
  ExportResult,
  HarvestProgress,
  HarvestResult,
  ImportResult,
  NewBook,
  NewNote,
  Note,
  NotePatch,
  OlBookDto,
  Recommendation,
  RecommendationNode,
  RecommendationQuery,
  SearchHit
} from '@shared/api'

// SQLite is the source of truth: a mutation invalidates the slices it touched
// rather than patching a local copy.
const api = (): InterleafBridge => window.interleaf

const keys = {
  books: ['books'] as const,
  notes: ['notes'] as const,
  notesFor: (bookId?: number | null) => ['notes', bookId ?? 'all'] as const,
  note: (id: number) => ['note', id] as const,
  metadata: (bookId: number) => ['metadata', bookId] as const,
  bookSubjects: ['book-subjects'] as const,
  recommendations: ['recommendations'] as const,
  recommendationsFor: (query: RecommendationQuery) => ['recommendations', query] as const,
  recommendationTree: ['recommendation-tree'] as const,
  recommendationTreeFor: (query: RecommendationQuery) => ['recommendation-tree', query] as const,
  dismissed: ['dismissed'] as const,
  dataCounts: ['data-counts'] as const,
  search: (query: string) => ['search', query] as const,
  openLibrary: (query: string) => ['open-library', query] as const
}

// Anything a note write can affect.
function invalidateNotes(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: keys.notes })
  void client.invalidateQueries({ queryKey: ['note'] })
}

function invalidateBooks(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: keys.books })
}

// The list and the tree are one scoring; they go stale together.
function invalidateRecommendations(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: keys.recommendations })
  void client.invalidateQueries({ queryKey: keys.recommendationTree })
}

// ---------------------------------------------------------------- reads

export function useBooks(): UseQueryResult<Book[]> {
  return useQuery({ queryKey: keys.books, queryFn: () => api().listBooks() })
}

// Read from the library list so it cannot drift from it.
export function useBook(id: number | null): Book | null {
  const { data } = useBooks()
  if (id === null) return null
  return data?.find((b) => b.id === id) ?? null
}

export function useNotes(bookId?: number | null): UseQueryResult<Note[]> {
  return useQuery({
    queryKey: keys.notesFor(bookId),
    queryFn: () => (bookId === undefined ? api().listNotes() : api().listNotes(bookId))
  })
}

export function useNote(id: number): UseQueryResult<Note | null> {
  return useQuery({ queryKey: keys.note(id), queryFn: () => api().getNote(id) })
}

export function useBookMetadata(bookId: number): UseQueryResult<BookMetadata | null> {
  return useQuery({ queryKey: keys.metadata(bookId), queryFn: () => api().getBookMetadata(bookId) })
}

export function useBookSubjects(): UseQueryResult<BookSubjects[]> {
  return useQuery({ queryKey: keys.bookSubjects, queryFn: () => api().listBookSubjects() })
}

export function useSearch(query: string): UseQueryResult<SearchHit[]> {
  return useQuery({
    queryKey: keys.search(query),
    queryFn: () => api().search(query, 8),
    enabled: query.trim().length >= 2
  })
}

// The only query that reaches the network, so it is cached for the session.
export function useOpenLibrarySearch(query: string): UseQueryResult<OlBookDto[]> {
  return useQuery({
    queryKey: keys.openLibrary(query),
    queryFn: () => api().searchOpenLibrary(query),
    enabled: query.trim().length >= 2,
    staleTime: Infinity,
    retry: false
  })
}

// The limit goes to the recommender rather than being applied here: it widens
// the MMR pool as well as the list.
export function useRecommendations(
  query: RecommendationQuery = {}
): UseQueryResult<Recommendation[]> {
  return useQuery({
    queryKey: keys.recommendationsFor(query),
    queryFn: () => api().getRecommendations(query),
    // A changed filter changes the key, and the grid would otherwise flash its
    // empty state while the rescore runs.
    placeholderData: (previous) => previous
  })
}

export function useRecommendationTree(
  query: RecommendationQuery = {}
): UseQueryResult<RecommendationNode[]> {
  return useQuery({
    queryKey: keys.recommendationTreeFor(query),
    queryFn: () => api().getRecommendationTree(query),
    placeholderData: (previous) => previous
  })
}

// ---------------------------------------------------------------- writes

export function useCreateBook(): UseMutationResult<Book, Error, NewBook> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: NewBook) => api().createBook(input),
    onSuccess: () => invalidateBooks(client)
  })
}

export function useAddFromOpenLibrary(): UseMutationResult<Book, Error, OlBookDto> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (dto: OlBookDto) => api().addBookFromOpenLibrary(dto),
    onSuccess: () => invalidateBooks(client)
  })
}

export function useUpdateBook(): UseMutationResult<
  Book | null,
  Error,
  { id: number; patch: BookPatch }
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: BookPatch }) => api().updateBook(id, patch),
    onSuccess: () => {
      invalidateBooks(client)
      invalidateRecommendations(client)
    }
  })
}

export function useDeleteBook(): UseMutationResult<void, Error, number> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api().deleteBook(id),
    onSuccess: () => {
      invalidateBooks(client)
      invalidateNotes(client)
    }
  })
}

export function useEnrichBook(): UseMutationResult<Book | null, Error, number> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (bookId: number) => api().enrichBook(bookId),
    onSuccess: (_book, bookId) => {
      invalidateBooks(client)
      void client.invalidateQueries({ queryKey: keys.metadata(bookId) })
      void client.invalidateQueries({ queryKey: keys.bookSubjects })
    }
  })
}

// Opens a file dialog, so it stays pending while the reader browses.
export function useChooseCover(): UseMutationResult<Book | null, Error, number> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (bookId: number) => api().chooseCover(bookId),
    onSuccess: () => invalidateBooks(client)
  })
}

export function useRemoveCover(): UseMutationResult<Book | null, Error, number> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (bookId: number) => api().removeCover(bookId),
    onSuccess: () => invalidateBooks(client)
  })
}

export function useCreateNote(): UseMutationResult<Note, Error, NewNote> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: NewNote) => api().createNote(input),
    onSuccess: () => invalidateNotes(client)
  })
}

export function useUpdateNote(): UseMutationResult<
  Note | null,
  Error,
  { id: number; patch: NotePatch }
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: NotePatch }) => api().updateNote(id, patch),
    onSuccess: () => invalidateNotes(client)
  })
}

export function useDeleteNote(): UseMutationResult<void, Error, number> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api().deleteNote(id),
    onSuccess: () => invalidateNotes(client)
  })
}

export function useRefreshRecommendations(): UseMutationResult<HarvestResult, Error, void> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => api().refreshRecommendations(),
    onSuccess: () => invalidateRecommendations(client)
  })
}

// Subscribed on mount rather than when a refresh starts: `isPending` flips
// during render, and an effect on that edge races the harvest's first steps.
export function useHarvestProgress(active: boolean): HarvestProgress | null {
  const [progress, setProgress] = useState<HarvestProgress | null>(null)
  const [wasActive, setWasActive] = useState(active)

  useEffect(() => api().onHarvestProgress(setProgress), [])

  // Dropped as the run ends, so no second pass shows the finished bar.
  if (active !== wasActive) {
    setWasActive(active)
    setProgress(null)
  }

  return active ? progress : null
}

export function useDismissRecommendation(): UseMutationResult<void, Error, string> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (olid: string) => api().dismissRecommendation(olid),
    onSuccess: () => invalidateRecommendations(client)
  })
}

export function useSaveRecommendation(): UseMutationResult<Book, Error, string> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (olid: string) => api().saveRecommendation(olid),
    onSuccess: () => {
      invalidateBooks(client)
      invalidateRecommendations(client)
    }
  })
}

// ---------------------------------------------------------------- data

export function useDismissed(): UseQueryResult<DismissedBook[]> {
  return useQuery({ queryKey: keys.dismissed, queryFn: () => api().listDismissed() })
}

export function useDataCounts(): UseQueryResult<DataCounts> {
  return useQuery({ queryKey: keys.dataCounts, queryFn: () => api().dataCounts() })
}

export function useRestoreDismissed(): UseMutationResult<void, Error, string> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (olid: string) => api().restoreDismissed(olid),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.dismissed })
      invalidateRecommendations(client)
      void client.invalidateQueries({ queryKey: keys.dataCounts })
    }
  })
}

// Invalidates everything rather than naming slices: getting that list wrong
// leaves rows on screen that no longer exist.
function invalidateEverything(client: QueryClient): void {
  void client.invalidateQueries()
}

export function useDeleteAllBooks(): UseMutationResult<number, Error, void> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => api().deleteAllBooks(),
    onSuccess: () => invalidateEverything(client)
  })
}

export function useDeleteAllNotes(): UseMutationResult<number, Error, void> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => api().deleteAllNotes(),
    onSuccess: () => invalidateEverything(client)
  })
}

export function useDeleteEverything(): UseMutationResult<void, Error, void> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => api().deleteEverything(),
    onSuccess: () => invalidateEverything(client)
  })
}

export function useExportVault(): UseMutationResult<ExportResult | null, Error, void> {
  return useMutation({ mutationFn: () => api().exportVault() })
}

export function useImportVault(): UseMutationResult<ImportResult | null, Error, void> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => api().importVault(),
    onSuccess: () => {
      invalidateBooks(client)
      invalidateNotes(client)
    }
  })
}
