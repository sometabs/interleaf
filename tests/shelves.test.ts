import { describe, expect, it } from 'vitest'

import type { Book, BookStatus } from '../src/shared/api'
import {
  categoriesOf,
  filterByCategory,
  genresIn,
  groupBooks,
  GROUPINGS,
  sortKey
} from '../src/renderer/src/lib/shelves'

let nextId = 1

function book(title: string, status: BookStatus = 'want'): Book {
  return {
    id: nextId++,
    title,
    author: null,
    isbn: null,
    editionOlid: null,
    olid: null,
    coverPath: null,
    pageCount: null,
    publishedYear: null,
    status,
    rating: null,
    startedAt: null,
    genres: null,
    finishedAt: null,
    createdAt: 0,
    updatedAt: 0
  }
}

function cats(...rows: [Book, string[]][]): ReturnType<typeof categoriesOf> {
  return categoriesOf(rows.map(([b, genres]) => ({ ...b, genres })))
}

function labels(shelves: { label: string }[]): string[] {
  return shelves.map((shelf) => shelf.label)
}

describe('grouping by status', () => {
  it('shelves each status in reading order and drops the empty ones', () => {
    const shelves = groupBooks([book('A', 'read'), book('B', 'reading')], 'status')

    expect(labels(shelves)).toEqual(['Reading', 'Read'])
  })
})

describe('grouping alphabetically', () => {
  it('files books under their first letter, in order', () => {
    const shelves = groupBooks([book('Solaris'), book('Anathem'), book('Aurora')], 'alphabet')

    expect(labels(shelves)).toEqual(['A', 'S'])
    expect(shelves[0].books.map((b) => b.title)).toEqual(['Anathem', 'Aurora'])
  })

  it('ignores a leading article, as a shelf does', () => {
    const shelves = groupBooks([book('The Dispossessed')], 'alphabet')

    expect(labels(shelves)).toEqual(['D'])
  })

  it('files an accented title under the plain letter', () => {
    expect(sortKey('Éclair')).toBe('eclair')
    expect(labels(groupBooks([book('Éclair')], 'alphabet'))).toEqual(['E'])
  })

  it('collects digits and symbols under a single bucket, sorted last', () => {
    const shelves = groupBooks([book('1984'), book('Ubik'), book('…and then')], 'alphabet')

    expect(labels(shelves)).toEqual(['U', '#'])
    expect(shelves[1].books).toHaveLength(2)
  })
})

describe('grouping by author', () => {
  function by(author: string | null, title = `Book ${nextId}`): Book {
    return { ...book(title), author }
  }

  it('shelves each author once, alphabetically, with their books by title', () => {
    const shelves = groupBooks(
      [
        by('Ursula K. Le Guin', 'The Dispossessed'),
        by('Frank Herbert', 'Dune Messiah'),
        by('Frank Herbert', 'Dune')
      ],
      'author'
    )

    expect(labels(shelves)).toEqual(['Frank Herbert', 'Ursula K. Le Guin'])
    expect(shelves[0].books.map((b) => b.title)).toEqual(['Dune', 'Dune Messiah'])
  })

  it('folds spellings that differ by nothing into one shelf', () => {
    const shelves = groupBooks(
      [by('Frank Herbert'), by('  frank   herbert '), by('Émile Zola'), by('Emile Zola')],
      'author'
    )

    expect(shelves).toHaveLength(2)
    // Labelled as spelled but ordered by the fold, so É files under E.
    expect(labels(shelves)).toEqual(['Émile Zola', 'Frank Herbert'])
    expect(shelves[1].books).toHaveLength(2)
  })

  // ł is its own letter, not an accented l, so the fold leaves it alone.
  it('does not fold letters that are not accented forms', () => {
    expect(groupBooks([by('Stanisław Lem'), by('Stanislaw Lem')], 'author')).toHaveLength(2)
  })

  it('puts the books with no author on one shelf, last', () => {
    const shelves = groupBooks(
      [by(null), by('Ursula K. Le Guin'), by('   '), by('Frank Herbert')],
      'author'
    )

    expect(labels(shelves)).toEqual(['Frank Herbert', 'Ursula K. Le Guin', 'Unknown author'])
    expect(shelves[2].books).toHaveLength(2)
  })

  // Sorted by the name as written: a reader looks for Le Guin under U.
  it('orders by the whole name rather than by surname', () => {
    const shelves = groupBooks([by('Ursula K. Le Guin'), by('Brian Herbert')], 'author')

    expect(labels(shelves)).toEqual(['Brian Herbert', 'Ursula K. Le Guin'])
  })

  it('is offered as a grouping', () => {
    expect(GROUPINGS.map((option) => option.value)).toContain('author')
    expect(GROUPINGS.find((option) => option.value === 'author')?.label).toBe('Author')
  })
})

describe('grouping by category', () => {
  it('shelves books under their genres, biggest first', () => {
    const a = book('Solaris')
    const b = book('Roadside Picnic')
    const c = book('Wolf Hall')
    const shelves = groupBooks(
      [a, b, c],
      'category',
      cats([a, ['Science Fiction']], [b, ['Science Fiction']], [c, ['Historical Fiction']])
    )

    expect(labels(shelves)).toEqual(['Science Fiction', 'Historical Fiction'])
  })

  it('does not turn raw Open Library subjects into headings', () => {
    const a = book('All Systems Red')
    const categories = categoriesOf([a])
    const shelves = groupBooks([a], 'category', categories)

    expect(labels(shelves)).toEqual(['Not categorised yet'])
  })

  it('stands a book on every shelf its genres name', () => {
    const a = book('The Kaiju Preservation Society')
    const b = book('Wolf Hall')
    const shelves = groupBooks(
      [a, b],
      'category',
      cats([a, ['Science Fiction', 'Thriller & Suspense']], [b, ['Historical Fiction']])
    )

    expect(labels(shelves)).toEqual([
      'Historical Fiction',
      'Science Fiction',
      'Thriller & Suspense'
    ])
    expect(shelves[1].books.map((x) => x.title)).toEqual(['The Kaiju Preservation Society'])
    expect(shelves[2].books.map((x) => x.title)).toEqual(['The Kaiju Preservation Society'])
  })

  it('leaves an unchosen book unfiled even when Open Library has subjects', () => {
    const a = book('Solaris')
    const b = book('Some Technical Manual')
    const categories = categoriesOf([a, b])
    const shelves = groupBooks([a, b], 'category', categories)

    expect(labels(shelves)).toEqual(['Not categorised yet'])
  })

  it('sorts the unfiled shelf after chosen genres', () => {
    const named = book('Solaris')
    const plain = [book('X'), book('Y'), book('Z')]
    const categories = categoriesOf([{ ...named, genres: ['Science Fiction'] }, ...plain])
    const shelves = groupBooks([named, ...plain], 'category', categories)

    expect(labels(shelves)).toEqual(['Science Fiction', 'Not categorised yet'])
    expect(shelves[1].books).toHaveLength(3)
  })

  it('says a book has not been filed rather than guessing at its group', () => {
    const a = book('Solaris')

    expect(labels(groupBooks([a], 'category', cats()))).toEqual(['Not categorised yet'])
  })
})

describe('filtering by group, then by genre', () => {
  const novel = book('Solaris')
  const thriller = book('The Girl With All the Gifts')
  const memoir = book("Can't Hurt Me")
  const all = [novel, thriller, memoir]
  const categories = cats(
    [novel, ['Science Fiction']],
    [thriller, ['Science Fiction', 'Thriller & Suspense']],
    [memoir, ['Biography & Memoir', 'Sports']]
  )

  it('narrows to one half of the shop', () => {
    expect(filterByCategory(all, categories, 'Fiction', null).map((b) => b.title)).toEqual([
      'Solaris',
      'The Girl With All the Gifts'
    ])
    expect(filterByCategory(all, categories, 'Non-fiction', null).map((b) => b.title)).toEqual([
      "Can't Hurt Me"
    ])
  })

  it('then narrows to one genre inside it', () => {
    const fiction = filterByCategory(all, categories, 'Fiction', null)

    expect(
      filterByCategory(fiction, categories, null, 'Thriller & Suspense').map((b) => b.title)
    ).toEqual(['The Girl With All the Gifts'])
  })

  it('offers only the genres present in the chosen group', () => {
    expect(genresIn(filterByCategory(all, categories, 'Fiction', null), categories)).toEqual([
      'Science Fiction',
      'Thriller & Suspense'
    ])
    expect(genresIn(filterByCategory(all, categories, 'Non-fiction', null), categories)).toEqual([
      'Biography & Memoir',
      'Sports'
    ])
  })

  it('offers the commonest genre first', () => {
    expect(genresIn(all, categories)[0]).toBe('Science Fiction')
  })

  it('passes everything through when neither is chosen', () => {
    expect(filterByCategory(all, categories, null, null)).toHaveLength(3)
  })

  it('keeps an unfiled book out of both groups rather than guessing', () => {
    const unknown = book('Never Looked Up')
    const withUnknown = [...all, unknown]

    expect(filterByCategory(withUnknown, categories, null, null)).toHaveLength(4)
    // Belongs to neither half, so a group filter must not include it.
    expect(filterByCategory(withUnknown, categories, 'Fiction', null)).not.toContain(unknown)
    expect(filterByCategory(withUnknown, categories, 'Non-fiction', null)).not.toContain(unknown)
  })
})

// Asserted on `categoriesOf` rather than the picker that feeds it: the override
// is what makes a hand-typed or misfiled book filable.
describe('genres chosen by the reader', () => {
  it('uses the reader choice and ignores unrelated subjects', () => {
    const b = { ...book('Dune'), genres: ['Psychology'] }
    const categories = categoriesOf([b])

    expect(categories.get(b.id)).toEqual({ group: 'Non-fiction', genres: ['Psychology'] })
  })

  it('files a book Open Library has never heard of', () => {
    const b = { ...book('Unfu*k Yourself'), genres: ['Self-Help'] }
    const categories = categoriesOf([b])

    expect(categories.get(b.id)?.genres).toEqual(['Self-Help'])
  })

  it('does not invent a genre when nothing has been chosen', () => {
    const b = book('Dune')
    const categories = categoriesOf([b])

    expect(categories.has(b.id)).toBe(false)
  })

  it('unfiles a book whose genres were cleared', () => {
    const b = { ...book('Dune'), genres: [] }
    const categories = categoriesOf([b])

    expect(categories.has(b.id)).toBe(false)
  })

  it('carries the choice into the filters and the shelves', () => {
    const b = { ...book('Dune'), genres: ['Psychology'] }
    const categories = categoriesOf([b])

    expect(labels(groupBooks([b], 'category', categories))).toEqual(['Psychology'])
    expect(filterByCategory([b], categories, 'Fiction', null)).toEqual([])
    expect(filterByCategory([b], categories, 'Non-fiction', null)).toEqual([b])
    expect(genresIn([b], categories)).toEqual(['Psychology'])
  })
})
