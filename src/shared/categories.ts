// Categories are a reader-owned filing system. Open Library subjects stay as
// Open Library wrote them and are never translated into these labels.

export type BookGroup = 'Fiction' | 'Non-fiction'

export interface BookCategories {
  group: BookGroup
  genres: string[]
}

export const GENRES_BY_GROUP: Readonly<Record<BookGroup, readonly string[]>> = {
  Fiction: [
    'Science Fiction',
    'Fantasy',
    'Historical Fiction',
    'Mystery',
    'Thriller & Suspense',
    'Horror',
    'Romance',
    'Young Adult',
    'Children',
    'Poetry',
    'Comics & Graphic Novels',
    'Drama'
  ],
  'Non-fiction': [
    'True Crime',
    'Philosophy',
    'Biography & Memoir',
    'History',
    'Psychology',
    'Religion & Spirituality',
    'Politics',
    'Business',
    'Technology',
    'Science',
    'Sports',
    'Health & Fitness',
    'Self-Help',
    'Travel',
    'Cookbooks & Food',
    'Art & Photography',
    'Nature',
    'Education'
  ]
}

const GROUP_OF = new Map<string, BookGroup>()
for (const group of ['Fiction', 'Non-fiction'] as const) {
  for (const genre of GENRES_BY_GROUP[group]) GROUP_OF.set(genre, group)
}

// The group is derived from the first valid choice, so a book cannot be filed
// under a contradictory group. Unknown labels from old or malformed rows are
// ignored rather than becoming new app-authored categories.
export function fromChosenGenres(chosen: readonly string[]): BookCategories | null {
  const genres = chosen.filter((genre) => GROUP_OF.has(genre))
  if (genres.length === 0) return null
  return { group: GROUP_OF.get(genres[0]) as BookGroup, genres }
}
