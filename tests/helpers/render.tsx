import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { vi } from 'vitest'

import type {
  Book,
  InterleafApi,
  InterleafBridge,
  HarvestProgress,
  MetadataRefreshProgress,
  SemanticProgress,
  Note
} from '../../src/shared/api'
import { fail } from '../../src/renderer/src/lib/feedback'
import { ViewProvider, type View } from '../../src/renderer/src/lib/view'

export function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: 1,
    title: 'The Dispossessed',
    author: 'Ursula K. Le Guin',
    isbn: null,
    editionOlid: null,
    olid: null,
    coverPath: null,
    pageCount: null,
    publishedYear: null,
    status: 'want',
    rating: null,
    startedAt: null,
    genres: null,
    finishedAt: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

export function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 10,
    bookId: null,
    kind: 'thought',
    title: 'On walls',
    bodyMd: 'The wall was ambiguous.',
    createdAt: 0,
    updatedAt: Math.floor(Date.now() / 1000),
    tag: null,
    ...overrides
  }
}

// A fake preload bridge over in-memory arrays: writes are visible to the next
// read, as they are in the real repositories.
export interface FakeBridge {
  books: Book[]
  notes: Note[]
  created: unknown[]
  deleted: number[]
  emitHarvestProgress: (progress: HarvestProgress) => void
  emitMetadataRefreshProgress: (progress: MetadataRefreshProgress) => void
  emitSemanticProgress: (progress: SemanticProgress) => void
}

export function installBridge(
  initial: { books?: Book[]; notes?: Note[] } = {},
  overrides: Partial<InterleafApi> = {}
): FakeBridge {
  const listeners = new Set<(progress: HarvestProgress) => void>()
  const metadataListeners = new Set<(progress: MetadataRefreshProgress) => void>()
  const semanticListeners = new Set<(progress: SemanticProgress) => void>()

  const state: FakeBridge = {
    books: initial.books ?? [],
    notes: initial.notes ?? [],
    created: [],
    deleted: [],
    emitHarvestProgress: (progress) => {
      for (const listener of listeners) listener(progress)
    },
    emitMetadataRefreshProgress: (progress) => {
      for (const listener of metadataListeners) listener(progress)
    },
    emitSemanticProgress: (progress) => {
      for (const listener of semanticListeners) listener(progress)
    }
  }
  let nextId = 90

  const bridge: Partial<InterleafBridge> = {
    onHarvestProgress: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    onMetadataRefreshProgress: (listener) => {
      metadataListeners.add(listener)
      return () => metadataListeners.delete(listener)
    },
    onSemanticProgress: (listener) => {
      semanticListeners.add(listener)
      return () => semanticListeners.delete(listener)
    },

    listBooks: async () => state.books.map((book) => ({ ...book })),
    listNotes: async (bookId?: number | null) =>
      state.notes
        .filter((note) => bookId === undefined || note.bookId === bookId)
        .map((note) => ({ ...note })),
    getNote: async (id: number) => state.notes.find((note) => note.id === id) ?? null,
    getBookMetadata: async () => null,
    search: async () => [],
    getRecommendations: async () => [],
    refreshAllMetadata: async () => ({
      refreshed: state.books.length,
      failures: [],
      cancelled: false,
      offline: false
    }),
    retryMetadataRefresh: async (bookIds) => ({
      refreshed: bookIds.length,
      failures: [],
      cancelled: false,
      offline: false
    }),
    cancelMetadataRefresh: async () => {},

    createBook: async (input) => {
      const book = makeBook({ ...input, id: nextId++ })
      state.books.push(book)
      state.created.push(input)
      return book
    },
    updateBook: async (id, patch) => {
      const index = state.books.findIndex((book) => book.id === id)
      if (index === -1) return null
      state.books[index] = { ...state.books[index], ...patch }
      return { ...state.books[index] }
    },
    deleteBook: async (id) => {
      state.deleted.push(id)
      state.books = state.books.filter((book) => book.id !== id)
    },
    createNote: async (input) => {
      const note = makeNote({
        id: nextId++,
        bookId: input.bookId ?? null,
        kind: input.kind ?? 'thought',
        title: input.title ?? '',
        bodyMd: input.bodyMd ?? ''
      })
      state.notes.push(note)
      state.created.push(input)
      return note
    },
    updateNote: async (id, patch) => {
      const index = state.notes.findIndex((note) => note.id === id)
      if (index === -1) return null
      state.notes[index] = { ...state.notes[index], ...patch }
      return { ...state.notes[index] }
    },
    deleteNote: async (id) => {
      state.deleted.push(id)
      state.notes = state.notes.filter((note) => note.id !== id)
    },

    ...overrides
  }

  vi.stubGlobal('window', window)
  ;(window as unknown as { interleaf: unknown }).interleaf = bridge
  return state
}

function Providers({
  children,
  initialView
}: {
  children: ReactNode
  initialView?: View
}): ReactNode {
  const client = new QueryClient({
    mutationCache: undefined,
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false, onError: (error) => fail(error) }
    }
  })

  return (
    <QueryClientProvider client={client}>
      <ViewProvider initial={initialView}>{children}</ViewProvider>
    </QueryClientProvider>
  )
}

export function renderApp(ui: ReactElement, initialView?: View): RenderResult {
  return render(ui, {
    wrapper: ({ children }) => <Providers initialView={initialView}>{children}</Providers>
  })
}
