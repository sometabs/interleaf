import { describe, expect, it } from 'vitest'

import {
  recommend,
  recommendTree,
  type CandidateInput,
  type ProfileBook
} from '../src/main/services/recommender'

function lib(partial: Partial<ProfileBook> & { bookId: number; title: string }): ProfileBook {
  return {
    author: null,
    rating: 5,
    subjects: [],
    description: null,
    finishedAt: null,
    ...partial
  }
}

function cand(partial: Partial<CandidateInput> & { olid: string; title: string }): CandidateInput {
  // The pool is filtered to English editions, so a fixture with no language
  // would be dropped before it is ever scored.
  return {
    author: null,
    subjects: [],
    description: null,
    coverId: null,
    languages: ['eng'],
    ...partial
  }
}

const SCIFI = ['science fiction', 'utopias', 'anarchism', 'political fiction']
const COOKING = ['cooking', 'recipes', 'italian cuisine', 'food writing']

describe('recommend', () => {
  it('returns nothing without a library', () => {
    expect(recommend([], [cand({ olid: 'A', title: 'Anything', subjects: SCIFI })])).toEqual([])
  })

  it('returns nothing without candidates', () => {
    expect(recommend([lib({ bookId: 1, title: 'X', subjects: SCIFI })], [])).toEqual([])
  })

  it('ranks a subject match above an unrelated book', () => {
    const library = [lib({ bookId: 1, title: 'The Dispossessed', subjects: SCIFI, rating: 5 })]
    const candidates = [
      cand({ olid: 'FOOD', title: 'Pasta Nights', subjects: COOKING }),
      cand({ olid: 'SCIFI', title: 'The Left Hand of Darkness', subjects: SCIFI })
    ]

    const [top] = recommend(library, candidates)
    expect(top.olid).toBe('SCIFI')
  })

  it('explains itself by naming the closest book you liked', () => {
    const library = [
      lib({ bookId: 7, title: 'The Dispossessed', subjects: SCIFI, rating: 5 }),
      lib({ bookId: 8, title: 'Salt Fat Acid Heat', subjects: COOKING, rating: 5 })
    ]
    const [top] = recommend(library, [
      cand({ olid: 'C', title: 'Another Utopia', subjects: SCIFI })
    ])

    expect(top.becauseOf).toEqual({ bookId: 7, title: 'The Dispossessed' })
  })

  it('reports the candidate subjects exactly as Open Library returned them', () => {
    const library = [lib({ bookId: 1, title: 'A', subjects: SCIFI, rating: 5 })]
    const [top] = recommend(library, [
      cand({
        olid: 'C',
        title: 'B',
        subjects: ['genre:science fiction', 'franchise:Ekumen', 'Anarchism', 'Accessible book']
      })
    ])

    expect(top.subjects).toEqual([
      'genre:science fiction',
      'franchise:Ekumen',
      'Anarchism',
      'Accessible book'
    ])
  })

  it('ignores books rated below 3 when building taste', () => {
    const library = [
      lib({ bookId: 1, title: 'Loved', subjects: SCIFI, rating: 5 }),
      lib({ bookId: 2, title: 'Hated', subjects: COOKING, rating: 1 })
    ]
    const results = recommend(library, [
      cand({ olid: 'FOOD', title: 'More Cooking', subjects: COOKING }),
      cand({ olid: 'SCIFI', title: 'More Scifi', subjects: SCIFI })
    ])

    expect(results[0].olid).toBe('SCIFI')
  })

  it('returns nothing when every book was disliked', () => {
    const library = [lib({ bookId: 1, title: 'Hated', subjects: COOKING, rating: 1 })]
    expect(recommend(library, [cand({ olid: 'C', title: 'X', subjects: COOKING })])).toEqual([])
  })

  it('does not treat a want-to-read book as evidence of taste', () => {
    const library = [
      lib({ bookId: 1, title: 'Loved', status: 'read', subjects: SCIFI, rating: 5 }),
      lib({ bookId: 2, title: 'On the wishlist', status: 'want', subjects: COOKING, rating: 5 })
    ]
    const results = recommend(library, [
      cand({ olid: 'FOOD', title: 'More Cooking', subjects: COOKING }),
      cand({ olid: 'SCIFI', title: 'More Scifi', subjects: SCIFI })
    ])

    expect(results.map((book) => book.olid)).toEqual(['SCIFI'])
  })

  it('does not treat an unrated book as evidence of taste', () => {
    const library = [lib({ bookId: 1, title: 'Unread', subjects: SCIFI, rating: null })]

    expect(recommend(library, [cand({ olid: 'C', title: 'More Scifi', subjects: SCIFI })])).toEqual(
      []
    )
  })

  it('respects the limit', () => {
    const library = [lib({ bookId: 1, title: 'A', subjects: SCIFI, rating: 5 })]
    const candidates = Array.from({ length: 20 }, (_, i) =>
      cand({ olid: `C${i}`, title: `Book ${i}`, subjects: SCIFI })
    )

    expect(recommend(library, candidates, { limit: 5 })).toHaveLength(5)
  })

  it('diversifies rather than returning near-duplicates', () => {
    const library = [
      lib({ bookId: 1, title: 'A', subjects: SCIFI, rating: 5 }),
      lib({ bookId: 2, title: 'B', subjects: ['history', 'rome', 'empire'], rating: 5 })
    ]

    const candidates = [
      ...Array.from({ length: 8 }, (_, i) =>
        cand({ olid: `S${i}`, title: `Scifi ${i}`, subjects: SCIFI })
      ),
      cand({ olid: 'H0', title: 'Roman History', subjects: ['history', 'rome', 'empire'] })
    ]

    const picks = recommend(library, candidates, { limit: 4, diversity: 0.5 })
    expect(picks.some((p) => p.olid === 'H0')).toBe(true)
  })

  it('weights recent reading above long-ago reading', () => {
    const now = 1_800_000_000
    const year = 365.25 * 24 * 3600

    const library = [
      lib({ bookId: 1, title: 'Recent', subjects: SCIFI, rating: 4, finishedAt: now - 30 * 86400 }),
      lib({
        bookId: 2,
        title: 'Ancient',
        subjects: COOKING,
        rating: 4,
        finishedAt: now - 12 * year
      })
    ]

    const results = recommend(
      library,
      [
        cand({ olid: 'SCIFI', title: 'New Scifi', subjects: SCIFI }),
        cand({ olid: 'FOOD', title: 'New Cooking', subjects: COOKING })
      ],
      { now }
    )

    expect(results[0].olid).toBe('SCIFI')
  })

  it('produces scores between 0 and 1', () => {
    const library = [lib({ bookId: 1, title: 'A', subjects: SCIFI, rating: 5 })]
    const results = recommend(library, [cand({ olid: 'C', title: 'B', subjects: SCIFI })])

    expect(results[0].score).toBeGreaterThan(0)
    expect(results[0].score).toBeLessThanOrEqual(1.0001)
  })

  it('falls back to descriptions when subjects are missing', () => {
    const library = [
      lib({
        bookId: 1,
        title: 'A',
        rating: 5,
        description: 'An anarchist utopia on a barren moon, and the physicist who leaves it.'
      })
    ]
    const results = recommend(library, [
      cand({
        olid: 'MATCH',
        title: 'B',
        description: 'A physicist confronts an anarchist utopia.'
      }),
      cand({ olid: 'MISS', title: 'C', description: 'Weeknight pasta recipes for busy families.' })
    ])

    expect(results[0].olid).toBe('MATCH')
  })

  it('does not crash on empty subjects and descriptions', () => {
    const library = [lib({ bookId: 1, title: 'A', rating: 5 })]
    expect(() => recommend(library, [cand({ olid: 'C', title: 'B' })])).not.toThrow()
  })

  it('does not silently discard Open Library catalogue subjects', () => {
    const library = [
      lib({ bookId: 1, title: 'A', subjects: ['Accessible book', 'Large type books'] })
    ]
    const candidates = [
      cand({ olid: 'C', title: 'B', subjects: ['Accessible book', 'Large type books'] })
    ]

    expect(recommend(library, candidates).map((book) => book.olid)).toEqual(['C'])
  })
})

// Open Library tags an author's own series, and a term that rare dominates the
// vector, so repetition has to be caught by name rather than by geometry.
describe('author concentration', () => {
  const LE_GUIN = ['science fiction', 'utopias', 'hainish cycle', 'ekumen']

  const library = [
    lib({ bookId: 1, title: 'The Dispossessed', author: 'Ursula K. Le Guin', subjects: LE_GUIN })
  ]

  const candidates = [
    ...['Gender', 'Colonialism', 'Memory', 'Survival', 'Quests', 'Religion'].map((extra, i) =>
      cand({
        olid: `L${i}`,
        title: `Le Guin ${i}`,
        author: 'Ursula K. Le Guin',
        subjects: [...LE_GUIN, extra]
      })
    ),
    ...Array.from({ length: 12 }, (_, i) =>
      cand({
        olid: `O${i}`,
        title: `Other ${i}`,
        author: `Author ${i}`,
        subjects: ['science fiction', 'utopias', 'politics', `theme ${i}`]
      })
    )
  ]

  const byLeGuin = (list: { author: string | null }[]): number =>
    list.filter((r) => r.author === 'Ursula K. Le Guin').length

  function flatten(nodes: ReturnType<typeof recommendTree>): { author: string | null }[] {
    return nodes.flatMap((n) => [{ author: n.author }, ...flatten(n.children)])
  }

  it('gives one author at most two slots in the list', () => {
    const results = recommend(library, candidates, { limit: 6 })

    expect(results).toHaveLength(6)
    expect(byLeGuin(results)).toBe(2)
  })

  it('caps the tree the same way', () => {
    const nodes = flatten(recommendTree(library, candidates, { limit: 12 }))

    expect(nodes).toHaveLength(12)
    expect(byLeGuin(nodes)).toBe(2)
  })

  it('still leads with that author, because the match is real', () => {
    const results = recommend(library, candidates, { limit: 6 })

    expect(results[0].author).toBe('Ursula K. Le Guin')
  })

  it('fills the list anyway when the cap cannot be honoured', () => {
    const sameAuthor = Array.from({ length: 4 }, (_, i) =>
      cand({ olid: `S${i}`, title: `S${i}`, author: 'Solo', subjects: [...LE_GUIN, `x${i}`] })
    )

    expect(recommend(library, sameAuthor, { limit: 4 })).toHaveLength(4)
  })

  it('treats books with no author as unrelated rather than as one author', () => {
    const anonymous = Array.from({ length: 5 }, (_, i) =>
      cand({ olid: `N${i}`, title: `N${i}`, subjects: [...LE_GUIN, `x${i}`] })
    )

    expect(recommend(library, anonymous, { limit: 5 })).toHaveLength(5)
  })

  it('matches authors regardless of spacing and case', () => {
    const variants = [
      cand({ olid: 'V0', title: 'V0', author: 'Ursula K. Le Guin', subjects: LE_GUIN }),
      cand({ olid: 'V1', title: 'V1', author: '  ursula k. le guin ', subjects: LE_GUIN }),
      cand({ olid: 'V2', title: 'V2', author: 'URSULA K. LE GUIN', subjects: LE_GUIN }),
      ...Array.from({ length: 4 }, (_, i) =>
        cand({
          olid: `W${i}`,
          title: `W${i}`,
          author: `Someone ${i}`,
          subjects: ['science fiction', 'utopias', `theme ${i}`]
        })
      )
    ]

    const results = recommend(library, variants, { limit: 5 })
    const spellings = results.filter((r) => /le guin/i.test(r.author ?? '')).length

    expect(spellings).toBe(2)
  })

  it('can be turned off', () => {
    const results = recommend(library, candidates, { limit: 6, maxPerAuthor: 0 })

    expect(byLeGuin(results)).toBe(6)
  })
})

describe('scoping to authors already read', () => {
  const LEM = 'Stanisław Lem'
  const library = [
    lib({ bookId: 1, title: 'Solaris', author: LEM, subjects: SCIFI, rating: 5 }),
    lib({
      bookId: 2,
      title: 'Pasta Nights',
      author: 'Marcella Hazan',
      subjects: COOKING,
      rating: 5
    })
  ]
  const candidates = [
    cand({ olid: 'HMV', title: "His Master's Voice", author: LEM, subjects: SCIFI }),
    cand({ olid: 'FIA', title: 'Fiasco', author: 'stanisław lem', subjects: SCIFI }),
    cand({ olid: 'CYB', title: 'The Cyberiad', author: 'Stanisław Lem ', subjects: SCIFI }),
    cand({
      olid: 'LHD',
      title: 'The Left Hand of Darkness',
      author: 'Ursula K. Le Guin',
      subjects: SCIFI
    }),
    cand({ olid: 'ANON', title: 'Unattributed', author: null, subjects: SCIFI })
  ]

  it('keeps only books by authors on the shelf', () => {
    const found = recommend(library, candidates, { scope: 'same-authors' })

    expect(found.map((r) => r.olid).sort()).toEqual(['CYB', 'FIA', 'HMV'])
  })

  // Distinct subjects, so MMR does not thin these on its own, and there is
  // always another author to pick: the cap binds rather than relaxing.
  const capBinding = {
    library: [
      lib({ bookId: 1, title: 'Solaris', author: LEM, subjects: SCIFI, rating: 5 }),
      lib({
        bookId: 2,
        title: 'Pasta Nights',
        author: 'Marcella Hazan',
        subjects: COOKING,
        rating: 3
      })
    ],
    candidates: [
      cand({
        olid: 'A',
        title: 'A',
        author: LEM,
        subjects: ['science fiction', 'utopias', 'space']
      }),
      cand({
        olid: 'B',
        title: 'B',
        author: LEM,
        subjects: ['science fiction', 'anarchism', 'politics']
      }),
      cand({
        olid: 'C',
        title: 'C',
        author: LEM,
        subjects: ['science fiction', 'political fiction', 'first contact']
      }),
      cand({ olid: 'D', title: 'D', author: 'Marcella Hazan', subjects: COOKING })
    ]
  }

  function lemCount(found: { author: string | null }[]): number {
    return found.filter((r) => r.author?.trim().toLowerCase() === LEM.toLowerCase()).length
  }

  it('lifts the two-per-author cap, because crowding is the request', () => {
    const found = recommend(capBinding.library, capBinding.candidates, {
      scope: 'same-authors',
      limit: 3
    })

    expect(lemCount(found)).toBe(3)
  })

  it('keeps the cap when the scope is all', () => {
    const found = recommend(capBinding.library, capBinding.candidates, { limit: 3 })

    expect(lemCount(found)).toBe(2)
  })

  it('matches an author across spelling and spacing differences', () => {
    const found = recommend(library, candidates, { scope: 'same-authors' })

    expect(found.map((r) => r.olid)).toContain('FIA')
    expect(found.map((r) => r.olid)).toContain('CYB')
  })

  it('never counts an unattributed book as a known author', () => {
    const found = recommend(library, candidates, { scope: 'same-authors' })

    expect(found.map((r) => r.olid)).not.toContain('ANON')
  })

  it('leaves the pool alone when the scope is all', () => {
    expect(recommend(library, candidates).map((r) => r.olid)).toContain('LHD')
  })

  it('returns nothing rather than falling back when no candidate qualifies', () => {
    const strangers = [
      cand({ olid: 'X', title: 'Stranger', author: 'Nobody Known', subjects: SCIFI })
    ]

    expect(recommend(library, strangers, { scope: 'same-authors' })).toEqual([])
  })

  it('scopes the tree by the same rule', () => {
    const roots = recommendTree(library, candidates, { scope: 'same-authors' })
    const seen: string[] = []
    const walk = (nodes: typeof roots): void => {
      for (const node of nodes) {
        seen.push(node.olid)
        walk(node.children)
      }
    }
    walk(roots)

    expect(seen.sort()).toEqual(['CYB', 'FIA', 'HMV'])
  })
})

describe('filtering by language', () => {
  const shelf = [lib({ bookId: 1, title: 'The Dispossessed', subjects: SCIFI })]
  const pool = [
    cand({ olid: 'ENG', title: 'English one', subjects: SCIFI, languages: ['eng'] }),
    cand({ olid: 'JPN', title: 'Japanese one', subjects: SCIFI, languages: ['jpn'] }),
    cand({ olid: 'BOTH', title: 'Translated', subjects: SCIFI, languages: ['jpn', 'eng'] }),
    cand({ olid: 'NONE', title: 'Unrecorded', subjects: SCIFI, languages: [] })
  ]

  function olids(languages?: string[]): string[] {
    return recommend(shelf, pool, { languages, limit: 10 }).map((r) => r.olid)
  }

  it('keeps every book only when the filter is explicitly emptied', () => {
    expect(olids([]).sort()).toEqual(['BOTH', 'ENG', 'JPN', 'NONE'])
  })

  it('does not exclude original editions by default', () => {
    expect(olids(undefined).sort()).toEqual(['BOTH', 'ENG', 'JPN', 'NONE'])
  })

  it('drops books with no edition in a language you read', () => {
    expect(olids(['eng'])).not.toContain('JPN')
  })

  it('keeps a translated book, because one edition is enough', () => {
    expect(olids(['eng'])).toContain('BOTH')
  })

  it('drops a book whose language was never recorded', () => {
    // Stricter than the genre filters: unlabelled books do not count.
    expect(olids(['eng'])).not.toContain('NONE')
  })

  it('accepts any one of several preferred languages', () => {
    expect(olids(['fre', 'jpn']).sort()).toEqual(['BOTH', 'JPN'])
  })

  it('matches regardless of the case a code was stored in', () => {
    const shouty = [cand({ olid: 'UP', title: 'Shouty', subjects: SCIFI, languages: ['ENG'] })]
    expect(recommend(shelf, shouty, { languages: ['eng'] }).map((r) => r.olid)).toEqual(['UP'])
  })

  it('applies to the tree as well as the list', () => {
    const roots = recommendTree(shelf, pool, { languages: ['eng'], limit: 10 })
    const seen: string[] = []
    const walk = (nodes: typeof roots): void => {
      for (const node of nodes) {
        seen.push(node.olid)
        walk(node.children)
      }
    }
    walk(roots)

    expect(seen).not.toContain('JPN')
    expect(seen).toContain('ENG')
  })
})

describe('recommending like one book', () => {
  const HORROR = ['horror', 'gothic fiction', 'haunted houses', 'ghost stories']

  const shelf = [
    lib({ bookId: 1, title: 'The Dispossessed', subjects: SCIFI, rating: 5 }),
    lib({ bookId: 2, title: 'Salt Fat Acid Heat', subjects: COOKING, rating: 5 })
  ]

  const pool = [
    cand({ olid: 'SCIFI', title: 'The Left Hand of Darkness', subjects: SCIFI }),
    cand({ olid: 'FOOD', title: 'Pasta Nights', subjects: COOKING })
  ]

  it('ranks against the named book rather than the whole shelf', () => {
    const [top] = recommend(shelf, pool, { likeBookId: 2 })
    expect(top.olid).toBe('FOOD')
  })

  it('ignores every other book, however highly it was rated', () => {
    expect(recommend(shelf, pool, { likeBookId: 2 }).map((r) => r.olid)).toEqual(['FOOD'])
  })

  it('answers for a book that was rated badly', () => {
    const disliked = [lib({ bookId: 3, title: 'A Chore', subjects: COOKING, rating: 1 })]
    expect(recommend(disliked, pool, { likeBookId: 3 }).map((r) => r.olid)).toEqual(['FOOD'])
  })

  it('answers for a book that was never rated', () => {
    const unrated = [lib({ bookId: 4, title: 'Unread', subjects: COOKING, rating: null })]
    expect(recommend(unrated, pool, { likeBookId: 4 }).map((r) => r.olid)).toEqual(['FOOD'])
  })

  it('returns nothing when the book is no longer on the shelf', () => {
    expect(recommend(shelf, pool, { likeBookId: 404 })).toEqual([])
  })

  it('names the book itself as the reason', () => {
    const [top] = recommend(shelf, pool, { likeBookId: 2 })
    expect(top.becauseOf).toMatchObject({ bookId: 2, title: 'Salt Fat Acid Heat' })
  })

  it('finds nothing when the pool holds nothing near that book', () => {
    const outlier = [lib({ bookId: 9, title: 'The Haunting', subjects: HORROR })]
    expect(
      recommend(outlier, [cand({ olid: 'FOOD', title: 'Pasta', subjects: COOKING })], {
        likeBookId: 9
      })
    ).toEqual([])
  })

  it('applies to the tree as well as the list', () => {
    const roots = recommendTree(shelf, pool, { likeBookId: 2 })
    expect(roots.map((node) => node.olid)).toEqual(['FOOD'])
  })
})
