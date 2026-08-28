import { describe, expect, it } from 'vitest'

import { classify } from '../src/shared/categories'

function genresOf(subjects: string[]): string[] {
  return classify(subjects).genres
}

function groupOf(subjects: string[]): string {
  return classify(subjects).group
}

// Order inside the rule table matters: "science fiction" must never be read as
// science, nor "historical fiction" as history.

describe('classifying a book', () => {
  it('reduces a real Open Library subject list to one word', () => {
    expect(
      genresOf([
        'franchise:The Murderbot Diaries',
        'series:The Murderbot Diaries',
        'form:novella',
        'genre:science fiction',
        'Human-computer interaction',
        'Life on other planets'
      ])
    ).toEqual(['Science Fiction'])
  })

  it('believes an explicit genre facet over the headings around it', () => {
    // Without the facet, "Human-computer interaction" lands in Technology.
    expect(genresOf(['Human-computer interaction', 'Robots'])).toEqual(['Technology'])
    expect(genresOf(['genre:science fiction', 'Human-computer interaction', 'Robots'])).toEqual([
      'Science Fiction'
    ])
  })

  it('ignores facets that describe packaging rather than the book', () => {
    expect(genresOf(['franchise:Discworld', 'form:novella', 'place:Ankh-Morpork'])).toEqual([])
  })

  it('lets the subjects vote, so one stray heading cannot decide', () => {
    expect(genresOf(['Cookbooks & Food', 'History', 'Historical Fiction', 'History'])[0]).toBe(
      'History'
    )
  })

  it('breaks a tie towards the subject listed first', () => {
    expect(genresOf(['Psychology', 'Cookbooks & Food'])).toEqual(['Psychology', 'Cookbooks & Food'])
    expect(genresOf(['Cookbooks & Food', 'Psychology'])).toEqual(['Cookbooks & Food', 'Psychology'])
  })

  it('returns nothing when the vocabulary does not fit', () => {
    expect(genresOf([])).toEqual([])
    expect(genresOf(['Accessible book', 'Protected DAISY', 'In library'])).toEqual([])
  })
})

describe('the fiction / non-fiction split', () => {
  it('always answers, even for a book it knows nothing about', () => {
    expect(groupOf([])).toBe('Non-fiction')
    expect(groupOf(['Accessible book'])).toBe('Non-fiction')
  })

  it('follows the genres where there are any', () => {
    expect(groupOf(['Science fiction'])).toBe('Fiction')
    expect(groupOf(['Psychology'])).toBe('Non-fiction')
    expect(groupOf(['genre:fantasy'])).toBe('Fiction')
  })

  it('lets the genres outweigh the word "fiction" appearing in a heading', () => {
    expect(groupOf(['Fiction', 'Psychology', 'Cognitive science'])).toBe('Non-fiction')
  })

  it('falls back to the wording when no genre is recognised', () => {
    expect(groupOf(['Fiction'])).toBe('Fiction')
    expect(groupOf(['English fiction', 'Domestic fiction'])).toBe('Fiction')
    expect(groupOf(['Nonfiction'])).toBe('Non-fiction')
  })

  it('is not fooled by "non-fiction" containing "fiction"', () => {
    expect(groupOf(['Non-fiction'])).toBe('Non-fiction')
    expect(groupOf(['Non-fiction', 'Essays'])).toBe('Non-fiction')
  })

  it('splits a real crime case from a crime novel', () => {
    expect(groupOf(['True crime', 'Murder cases'])).toBe('Non-fiction')
    expect(groupOf(['Crime fiction', 'Detective stories'])).toBe('Fiction')
  })

  it('reads the whole of a real record correctly', () => {
    const found = classify([
      'nyt:advice-how-to-and-miscellaneous=2019-01-13',
      'New York Times bestseller',
      'United states, navy, seals',
      'United states, navy, biography',
      'United states, air force',
      'Triathlon',
      'Athletes, biography',
      'Endurance sports',
      'Motivation (psychology)',
      'Self-realization',
      'Marathon running',
      'Recreation'
    ])

    expect(found.group).toBe('Non-fiction')
    expect(found.genres).toContain('Biography & Memoir')
    expect(found.genres).toContain('Sports')
    expect(found.genres.length).toBeLessThanOrEqual(5)
  })
})

describe('books that are more than one thing', () => {
  it('keeps every genre the subjects support', () => {
    expect(genresOf(['Suspense', 'Science Fiction'])).toEqual([
      'Thriller & Suspense',
      'Science Fiction'
    ])
  })

  it('leads with the genre the subjects insist on most', () => {
    expect(genresOf(['Space opera', 'Suspense', 'Science Fiction'])).toEqual([
      'Science Fiction',
      'Thriller & Suspense'
    ])
  })

  it('stops at five, past which a chip row is a subject list again', () => {
    const many = genresOf([
      'Science fiction',
      'Suspense',
      'Horror',
      'Romance',
      'Poetry',
      'Comics',
      'Drama'
    ])

    expect(many).toHaveLength(5)
    expect(many).toEqual(['Science Fiction', 'Thriller & Suspense', 'Horror', 'Romance', 'Poetry'])
  })

  it('never lists the group as a genre', () => {
    expect(genresOf(['Fiction', 'Suspense'])).toEqual(['Thriller & Suspense'])
    expect(genresOf(['Fiction', 'English fiction'])).toEqual([])
  })

  it('reads several genre facets as several genres', () => {
    expect(genresOf(['genre:science fiction', 'genre:thriller', 'form:novella'])).toEqual([
      'Science Fiction',
      'Thriller & Suspense'
    ])
  })
})

describe('rules that would collide if the table were reordered', () => {
  it('reads science fiction as a genre, not as science', () => {
    expect(genresOf(['Science fiction'])).toEqual(['Science Fiction'])
    expect(genresOf(['Physics', 'Astronomy'])).toEqual(['Science'])
  })

  it('reads historical fiction as fiction, not as history', () => {
    expect(genresOf(['Historical fiction'])).toEqual(['Historical Fiction'])
    expect(genresOf(['World War, 1939-1945'])).toEqual(['History'])
  })

  it('reads ancient philosophy as philosophy, not as ancient history', () => {
    expect(genresOf(['Ethics', 'Stoics', 'Philosophy, ancient'])).toEqual(['Philosophy'])
    expect(genresOf(['Ancient civilization'])).toEqual(['History'])
  })

  it('reads a crime novel as Mystery and a real case as True Crime', () => {
    expect(genresOf(['Fiction', 'Detective and mystery stories'])).toEqual(['Mystery'])
    expect(genresOf(['Serial killers', 'Criminal investigation'])).toEqual(['True Crime'])
  })
})

describe('the labels themselves', () => {
  it('are short enough to read as a chip', () => {
    const seen = [
      ['Science fiction'],
      ['Psychology'],
      ['Cooking'],
      ['Biography'],
      ['Self-help'],
      ['True crime']
    ].flatMap((subjects) => genresOf(subjects))

    expect(seen).toHaveLength(6)
    for (const label of seen) {
      expect(label.length).toBeLessThanOrEqual(24)
      expect(label).not.toMatch(/[:=]/)
    }
  })
})
