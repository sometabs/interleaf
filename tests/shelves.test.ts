import { describe, expect, it } from 'vitest'

import type { Book, BookStatus } from '../src/shared/api'
import { groupBooks, GROUPINGS, sortKey } from '../src/renderer/src/lib/shelves'

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
    priorityPosition: null,
    createdAt: 0,
    updatedAt: 0
  }
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
    expect(shelves[0].books.map((entry) => entry.title)).toEqual(['Anathem', 'Aurora'])
  })

  it('ignores a leading article, as a shelf does', () => {
    expect(labels(groupBooks([book('The Dispossessed')], 'alphabet'))).toEqual(['D'])
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
    expect(shelves[0].books.map((entry) => entry.title)).toEqual(['Dune', 'Dune Messiah'])
  })

  it('folds spellings that differ by nothing into one shelf', () => {
    const shelves = groupBooks(
      [by('Frank Herbert'), by('  frank   herbert '), by('Émile Zola'), by('Emile Zola')],
      'author'
    )

    expect(shelves).toHaveLength(2)
    expect(labels(shelves)).toEqual(['Émile Zola', 'Frank Herbert'])
    expect(shelves[1].books).toHaveLength(2)
  })

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

  it('orders by the whole name rather than by surname', () => {
    const shelves = groupBooks([by('Ursula K. Le Guin'), by('Brian Herbert')], 'author')

    expect(labels(shelves)).toEqual(['Brian Herbert', 'Ursula K. Le Guin'])
  })

  it('is offered without the removed Category grouping', () => {
    expect(GROUPINGS.map((option) => option.label)).toEqual(['Status', 'Author', 'A–Z'])
  })
})
