import type { Database } from 'better-sqlite3'

import type { HarvestProgress, HarvestResult } from '../../shared/api'
import { classify } from '../../shared/categories'
import { READING_LANGUAGES } from '../../shared/languages'
import {
  booksWithMetadata,
  replaceCandidates,
  upsertCandidates,
  type CandidateRow
} from '../repos/metadata'
import { enrich } from './library'
import { fetchCandidates, type OlBook } from './openlibrary'

// Each unit is about a second of waiting. The backlog cap is tightest because
// an un-enriched book costs up to two requests before harvesting starts.
const MAX_BACKLOG = 5

export const DISCOVERY_REQUEST_LIMIT = 8
const MAX_SUBJECT_QUERIES = 6
const MAX_AUTHOR_SUBJECT_QUERIES = 2
const PER_SUBJECT_QUERY = 50
const PER_AUTHOR_QUERY = 30

// The local taxonomy chooses which interests receive a request. Open Library
// still filters through subject_key, whose names are not always the same as
// the labels shown in Interleaf.
const OPEN_LIBRARY_GENRE_SUBJECT: Readonly<Record<string, string>> = {
  'True Crime': 'true_crime',
  'Science Fiction': 'science_fiction',
  Fantasy: 'fantasy',
  'Historical Fiction': 'historical_fiction',
  Mystery: 'mystery',
  'Thriller & Suspense': 'thrillers',
  Horror: 'horror',
  Romance: 'romance',
  'Young Adult': 'young_adult_fiction',
  Children: 'juvenile_fiction',
  Poetry: 'poetry',
  'Comics & Graphic Novels': 'comic_books_strips_etc',
  Drama: 'drama',
  Philosophy: 'philosophy',
  'Biography & Memoir': 'biography',
  History: 'history',
  Psychology: 'psychology',
  'Religion & Spirituality': 'religion',
  Politics: 'politics',
  Business: 'business',
  Technology: 'technology',
  Science: 'science',
  Sports: 'sports',
  'Health & Fitness': 'health',
  'Self-Help': 'self_help',
  Travel: 'travel',
  'Cookbooks & Food': 'cooking',
  'Art & Photography': 'art',
  Nature: 'nature',
  Education: 'education'
}

// Where a book sits in a library, not what it is about.
const CATALOGUE =
  /^(accessible book|protected daisy|in library|overdrive|open library staff picks|large type books|lending library|internet archive wishlist)/i

// Matched whole, so "Literature and society" survives.
const BARE_GENERIC =
  /^(fiction|general|novels?|literature|books and reading|english fiction|english literature|american literature)$/i

const NEVER_A_TOPIC =
  /(award|prize winner|reading level|staff picks|bestseller|new york times|long now manual|translation|\blanguage\b)/i

// These are useful catalogue facts but make a whole request collapse onto one
// franchise rather than the reader's broader taste.
const FRANCHISE_FACET = /\((imaginary place|fictional character|fictitious character)\)/i

// A vocabulary, not language detection. "Roman" is left out because it also
// leads "Roman Britain", and refusing a real subject is the worse error.
const FOREIGN_LEAD =
  /^(historia|historias|novela|novelas|ficcion|literatura|cuentos|aventura|aventuras|supervivencia|geschichte|literatur|erzahlung|erzahlungen|deutsche?|amerikanisches|romanzo|storia|letteratura|litterature|histoire|nouvelles|ficcao|romance de)\b/i

// Open Library mixes description with filing, unmarked, and the harvest spends
// one request per subject in the order returned.
export function isTopicSubject(subject: string): boolean {
  const s = subject.trim()
  if (s.length < 3 || s.length > 40) return false
  if (/[:=/]/.test(s)) return false
  if (/[^\x20-\x7e]/.test(s)) return false
  if (/\bgrade\b|\bages?\s*\d/i.test(s)) return false
  // "Fiction, psychological", whose topical spelling is listed separately.
  if (s.includes(',')) return false
  return (
    !CATALOGUE.test(s) &&
    !BARE_GENERIC.test(s) &&
    !NEVER_A_TOPIC.test(s) &&
    !FRANCHISE_FACET.test(s) &&
    !FOREIGN_LEAD.test(s)
  )
}

// Containment only: synonyms would need a table not worth maintaining.
function withoutNearDuplicates(subjects: string[]): string[] {
  const kept: string[] = []
  const seen: string[] = []

  for (const subject of subjects) {
    const key = subject
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
    if (seen.some((other) => key.includes(other) || other.includes(key))) continue
    seen.push(key)
    kept.push(subject)
  }

  return kept
}

export interface DiscoveryBook {
  title: string
  author: string | null
  subjects: string[]
}

export interface DiscoveryQuery {
  query: string
  label: string
  source: string
  limit: number
}

export interface DiscoveryPlan {
  subjects: DiscoveryQuery[]
  authors: DiscoveryQuery[]
}

interface Topic {
  key: string
  label: string
  count: number
  order: number
  genres: string[]
}

// Open Library's exact subject keys are lower-case with punctuation and spaces
// normalised to underscores. `isTopicSubject` has already limited this to
// ASCII catalogue data.
function subjectKey(subject: string): string {
  return subject
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function subjectClause(topic: Topic): string {
  return `subject_key:${subjectKey(topic.key)}`
}

function authorClause(author: string): string {
  const safe = author.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim()
  return `author:"${safe}"`
}

// Pure so the API budget and exact questions can be tested without a network.
export function planDiscoveryQueries(books: DiscoveryBook[]): DiscoveryPlan {
  const topics = new Map<string, Topic>()
  const byBook: { book: DiscoveryBook; keys: string[] }[] = []
  const genreStats = new Map<string, { label: string; count: number; order: number }>()
  let order = 0
  let genreOrder = 0

  for (const book of books) {
    const labels = withoutNearDuplicates(book.subjects.filter(isTopicSubject).slice(0, 12))
    const keys: string[] = []
    const seen = new Set<string>()
    const bookGenres = new Set<string>()

    for (const label of labels) {
      const key = subjectKey(label)
      if (!key || seen.has(key)) continue
      seen.add(key)
      keys.push(key)
      const genres = classify([label]).genres
      for (const genre of genres) bookGenres.add(genre)

      const existing = topics.get(key)
      if (existing) existing.count += 1
      else topics.set(key, { key, label: label.trim(), count: 1, order: order++, genres })
    }

    for (const genre of bookGenres) {
      const existing = genreStats.get(genre)
      if (existing) existing.count += 1
      else genreStats.set(genre, { label: genre, count: 1, order: genreOrder++ })
    }
    byBook.push({ book, keys })
  }

  const rankedTopics = [...topics.values()].sort((a, b) => b.count - a.count || a.order - b.order)
  const rankedGenres = [...genreStats.values()].sort(
    (a, b) => b.count - a.count || a.order - b.order
  )

  const subjects: DiscoveryQuery[] = []
  const usedSubjectKeys = new Set<string>()

  function addTopic(topic: Topic): void {
    subjects.push({
      query: subjectClause(topic),
      label: `More books about ${topic.label}`,
      source: `subject:${topic.key}`,
      limit: PER_SUBJECT_QUERY
    })
    usedSubjectKeys.add(topic.key)
  }

  // Genres allocate the six discovery slots. The request still goes to Open
  // Library as a subject filter, but noisy raw metadata cannot make "history"
  // occupy four differently paired searches anymore.
  for (const genre of rankedGenres) {
    if (subjects.length === MAX_SUBJECT_QUERIES) break
    const key = OPEN_LIBRARY_GENRE_SUBJECT[genre.label] ?? subjectKey(genre.label)
    if (!key || usedSubjectKeys.has(key)) continue
    subjects.push({
      query: `subject_key:${key}`,
      label: `More ${genre.label} books`,
      source: `genre:${key}`,
      limit: PER_SUBJECT_QUERY
    })
    usedSubjectKeys.add(key)
  }

  // A small or unusual shelf may not classify into six genres. Its strongest
  // unclassified topics fill spare slots; classified topics are already
  // represented by their canonical genre request above.
  const fallbackTopics = rankedTopics.filter((topic) => topic.genres.length === 0)
  for (const topic of fallbackTopics) {
    if (subjects.length === MAX_SUBJECT_QUERIES) break
    if (!usedSubjectKeys.has(topic.key)) addTopic(topic)
  }

  const authorOptions: {
    author: string
    authorKey: string
    topicLabel: string
    subjectKey: string
  }[] = []
  const optionAuthors = new Set<string>()
  const topicRank = new Map(rankedTopics.map((topic, index) => [topic.key, index]))

  for (const { book, keys } of byBook) {
    const author = book.author?.trim()
    const authorKey = author?.toLowerCase()
    const genre = classify(book.subjects).genres[0]
    const strongestTopicKey = [...keys].sort(
      (a, b) => (topicRank.get(a) ?? Infinity) - (topicRank.get(b) ?? Infinity)
    )[0]
    const strongestTopic = strongestTopicKey ? topics.get(strongestTopicKey) : undefined
    const key = genre
      ? (OPEN_LIBRARY_GENRE_SUBJECT[genre] ?? subjectKey(genre))
      : (strongestTopic?.key ?? '')
    const topicLabel = genre ?? strongestTopic?.label
    if (!author || !authorKey || !topicLabel || !key || optionAuthors.has(authorKey)) continue

    optionAuthors.add(authorKey)
    authorOptions.push({ author, authorKey, topicLabel, subjectKey: key })
  }

  const authors: DiscoveryQuery[] = []
  const chosenAuthors = new Set<string>()

  function addAuthor(option: (typeof authorOptions)[number]): void {
    authors.push({
      query: `${authorClause(option.author)} AND subject_key:${option.subjectKey}`,
      label: `More by ${option.author} in ${option.topicLabel}`,
      source: `author:${option.author}|genre:${option.subjectKey}`,
      limit: PER_AUTHOR_QUERY
    })
    chosenAuthors.add(option.authorKey)
    usedSubjectKeys.add(option.subjectKey)
  }

  // Prefer familiar authors whose main genre did not already receive a broad
  // request. A homogeneous shelf can still use the remaining slots afterward.
  for (const option of authorOptions) {
    if (authors.length === MAX_AUTHOR_SUBJECT_QUERIES) break
    if (!usedSubjectKeys.has(option.subjectKey)) addAuthor(option)
  }
  for (const option of authorOptions) {
    if (authors.length === MAX_AUTHOR_SUBJECT_QUERIES) break
    if (!chosenAuthors.has(option.authorKey)) addAuthor(option)
  }

  return { subjects, authors }
}

// The only step that needs the network; scoring afterwards is offline.
export async function harvestCandidates(
  db: Database,
  languages: readonly string[] = READING_LANGUAGES,
  onProgress?: (progress: HarvestProgress) => void
): Promise<HarvestResult> {
  // Only books carrying an olid: resolving a hand-typed one means searching its
  // title, and Open Library answers any string with its closest match.
  const missing = db
    .prepare<[], { id: number }>(
      `SELECT b.id FROM book b
       LEFT JOIN book_metadata m ON m.book_id = b.id
       WHERE m.book_id IS NULL AND b.olid IS NOT NULL
       LIMIT ${MAX_BACKLOG}`
    )
    .all()

  // Worst case first, and it only ever shrinks, so the bar never retreats.
  let done = 0
  let total = missing.length + DISCOVERY_REQUEST_LIMIT
  const report = (label: string): void => onProgress?.({ done, total, label })

  for (const { id } of missing) {
    report('Filling in details for your books')
    await enrich(db, id)
    done += 1
  }

  const liked = booksWithMetadata(db)
    .filter((book) => book.status === 'read' && book.rating !== null && book.rating >= 4)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))

  if (liked.length === 0) {
    total = done
    report('Nothing to look for yet')
    return { harvested: 0, offline: false }
  }

  const plan = planDiscoveryQueries(liked)
  const maximumPlanned = plan.subjects.length + plan.authors.length
  if (maximumPlanned === 0) {
    total = done
    report('Nothing to look for yet')
    return { harvested: 0, offline: false }
  }

  const rows: CandidateRow[] = []
  let attempted = 0
  let answered = 0
  let failed = 0

  total = done + maximumPlanned

  async function runQuery(query: DiscoveryQuery): Promise<void> {
    report(query.label)
    attempted += 1
    const found = await fetchCandidates(query.query, query.limit, languages)
    done += 1
    if (found === null) {
      failed += 1
      return
    }

    answered += 1
    for (const b of found) {
      rows.push(candidateRow(b, query.source))
    }
  }

  for (const query of plan.subjects) await runQuery(query)
  for (const query of plan.authors) await runQuery(query)

  if (attempted > DISCOVERY_REQUEST_LIMIT) {
    throw new Error(`Discovery request budget exceeded: ${attempted}`)
  }

  total = done
  report('Sorting what came back')

  const unique = new Map(rows.map((r) => [r.olid, r]))
  const candidates = [...unique.values()]
  // Only a complete response may discard the last good cache. A partial
  // outage contributes what it found without shrinking the existing pool.
  const harvested =
    attempted === 0
      ? 0
      : failed === 0
        ? replaceCandidates(db, candidates)
        : upsertCandidates(db, candidates)

  return { harvested, offline: attempted > 0 && answered === 0 }
}

function candidateRow(book: OlBook, source: string): CandidateRow {
  return {
    olid: book.olid,
    title: book.title,
    author: book.author,
    subjects: book.subjects,
    description: null,
    coverId: book.coverId,
    languages: book.languages,
    source
  }
}
