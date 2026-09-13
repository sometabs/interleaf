import type { Database } from 'better-sqlite3'

import type { HarvestProgress, HarvestResult } from '../../shared/api'
import { READING_LANGUAGES } from '../../shared/languages'
import {
  booksWithMetadata,
  replaceCandidates,
  upsertCandidates,
  type CandidateRow
} from '../repos/metadata'
import { fetchCandidates, type OlBook } from './openlibrary'

export const DISCOVERY_REQUEST_LIMIT = 8
const MAX_SUBJECT_QUERIES = 6
const MAX_AUTHOR_SUBJECT_QUERIES = 2
const PER_SUBJECT_QUERY = 50
const PER_AUTHOR_QUERY = 30

// Query planning accepts Open Library's subject labels without a local genre
// vocabulary. Only an empty/non-searchable value is unusable.
export function isTopicSubject(subject: string): boolean {
  return subjectKey(subject).length > 0
}

// Containment only: synonyms would need a table not worth maintaining.
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
}

// Internal identity only. The actual API query uses Open Library's label as
// returned instead of guessing a subject slug.
function subjectKey(subject: string): string {
  return subject
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function subjectClause(topic: Topic): string {
  const safe = topic.label.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim()
  return `subject:"${safe}"`
}

function authorClause(author: string): string {
  const safe = author.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim()
  return `author:"${safe}"`
}

// Pure so the API budget and exact questions can be tested without a network.
export function planDiscoveryQueries(books: DiscoveryBook[]): DiscoveryPlan {
  const topics = new Map<string, Topic>()
  const byBook: { book: DiscoveryBook; keys: string[] }[] = []
  let order = 0

  for (const book of books) {
    const labels = book.subjects.filter(isTopicSubject)
    const keys: string[] = []
    const seen = new Set<string>()

    for (const label of labels) {
      const key = subjectKey(label)
      if (!key || seen.has(key)) continue
      seen.add(key)
      keys.push(key)

      const existing = topics.get(key)
      if (existing) existing.count += 1
      else topics.set(key, { key, label: label.trim(), count: 1, order: order++ })
    }
    byBook.push({ book, keys })
  }

  const rankedTopics = [...topics.values()].sort((a, b) => b.count - a.count || a.order - b.order)

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

  for (const topic of rankedTopics) {
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
    const strongestTopicKey = [...keys].sort(
      (a, b) => (topicRank.get(a) ?? Infinity) - (topicRank.get(b) ?? Infinity)
    )[0]
    const strongestTopic = strongestTopicKey ? topics.get(strongestTopicKey) : undefined
    const key = strongestTopic?.key ?? ''
    const topicLabel = strongestTopic?.label
    if (!author || !authorKey || !topicLabel || !key || optionAuthors.has(authorKey)) continue

    optionAuthors.add(authorKey)
    authorOptions.push({ author, authorKey, topicLabel, subjectKey: key })
  }

  const authors: DiscoveryQuery[] = []
  const chosenAuthors = new Set<string>()

  function addAuthor(option: (typeof authorOptions)[number]): void {
    const topic = topics.get(option.subjectKey)
    if (!topic) return
    authors.push({
      query: `${authorClause(option.author)} AND ${subjectClause(topic)}`,
      label: `More by ${option.author} in ${option.topicLabel}`,
      source: `author:${option.author}|subject:${option.subjectKey}`,
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
  onProgress?: (progress: HarvestProgress) => void,
  likeBookId?: number
): Promise<HarvestResult> {
  let done = 0
  let total = DISCOVERY_REQUEST_LIMIT
  const report = (label: string): void => onProgress?.({ done, total, label })

  const available = booksWithMetadata(db)
  const liked =
    likeBookId === undefined
      ? available
          .filter((book) => book.status === 'read' && book.rating !== null && book.rating >= 4)
          .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
      : available.filter((book) => book.bookId === likeBookId)

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
  // A shelf-wide refresh owns the whole cache and may replace it after a
  // complete response. A targeted "books like this" search only adds its
  // findings, so the user's general recommendations remain available.
  const harvested =
    attempted === 0
      ? 0
      : failed === 0 && likeBookId === undefined
        ? replaceCandidates(db, candidates)
        : upsertCandidates(db, candidates)

  return { harvested, offline: attempted > 0 && answered === 0 }
}

function candidateRow(book: OlBook, source: string): CandidateRow {
  return {
    olid: book.olid,
    editionOlid: book.editionOlid,
    isbn: book.isbn,
    title: book.title,
    author: book.author,
    subjects: book.subjects,
    description: book.description,
    coverId: book.coverId,
    pageCount: book.pageCount,
    publishedYear: book.publishedYear,
    languages: book.languages,
    source
  }
}
