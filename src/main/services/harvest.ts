import type { Database } from 'better-sqlite3'

import type { HarvestProgress, HarvestResult } from '../../shared/api'
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
const MAX_PRECISE_SUBJECT_QUERIES = 4
const MAX_FALLBACK_SUBJECT_QUERIES = 2
const MAX_AUTHOR_SUBJECT_QUERIES = 2
const PER_SUBJECT_QUERY = 50
const PER_AUTHOR_QUERY = 30
const FALLBACK_BELOW_CANDIDATES = 140

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
  precise: DiscoveryQuery[]
  fallbacks: DiscoveryQuery[]
  authors: DiscoveryQuery[]
}

interface Topic {
  key: string
  label: string
  count: number
  order: number
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
  let order = 0

  for (const book of books) {
    const labels = withoutNearDuplicates(book.subjects.filter(isTopicSubject).slice(0, 12))
    const keys: string[] = []
    const seen = new Set<string>()

    for (const label of labels) {
      const key = label.trim().toLowerCase()
      if (!subjectKey(key) || seen.has(key)) continue
      seen.add(key)
      keys.push(key)

      const existing = topics.get(key)
      if (existing) existing.count += 1
      else topics.set(key, { key, label: label.trim(), count: 1, order: order++ })
    }
    byBook.push({ book, keys })
  }

  const rankedTopics = [...topics.values()].sort((a, b) => b.count - a.count || a.order - b.order)

  const pairStats = new Map<
    string,
    { first: Topic; second: Topic; support: number; order: number }
  >()
  let pairOrder = 0

  for (const { keys } of byBook) {
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const ordered = [keys[i], keys[j]].sort()
        const pairKey = ordered.join('\0')
        const existing = pairStats.get(pairKey)
        if (existing) {
          existing.support += 1
          continue
        }

        const first = topics.get(ordered[0])
        const second = topics.get(ordered[1])
        if (first && second) {
          pairStats.set(pairKey, { first, second, support: 1, order: pairOrder++ })
        }
      }
    }
  }

  const precise = [...pairStats.values()]
    .sort(
      (a, b) =>
        b.support - a.support ||
        Math.min(b.first.count, b.second.count) - Math.min(a.first.count, a.second.count) ||
        b.first.count + b.second.count - (a.first.count + a.second.count) ||
        a.order - b.order
    )
    .slice(0, MAX_PRECISE_SUBJECT_QUERIES)
    .map(({ first, second }) => ({
      query: `${subjectClause(first)} AND ${subjectClause(second)}`,
      label: `Books about ${first.label} and ${second.label}`,
      source: `subjects:${first.key}+${second.key}`,
      limit: PER_SUBJECT_QUERY
    }))

  const fallbacks = rankedTopics.slice(0, MAX_FALLBACK_SUBJECT_QUERIES).map((topic) => ({
    query: subjectClause(topic),
    label: `More books about ${topic.label}`,
    source: `subject:${topic.key}`,
    limit: PER_SUBJECT_QUERY
  }))

  const rank = new Map(rankedTopics.map((topic, index) => [topic.key, index]))
  const seenAuthors = new Set<string>()
  const authors: DiscoveryQuery[] = []

  for (const { book, keys } of byBook) {
    const author = book.author?.trim()
    const authorKey = author?.toLowerCase()
    if (!author || !authorKey || seenAuthors.has(authorKey)) continue

    const topicKey = [...keys].sort(
      (a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity)
    )[0]
    const topic = topicKey ? topics.get(topicKey) : undefined
    if (!topic) continue

    seenAuthors.add(authorKey)
    authors.push({
      query: `${authorClause(author)} AND ${subjectClause(topic)}`,
      label: `More by ${author} about ${topic.label}`,
      source: `author:${author}|subject:${topic.key}`,
      limit: PER_AUTHOR_QUERY
    })
    if (authors.length === MAX_AUTHOR_SUBJECT_QUERIES) break
  }

  return { precise, fallbacks, authors }
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
  const maximumPlanned = plan.precise.length + plan.fallbacks.length + plan.authors.length
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

  for (const query of plan.precise) await runQuery(query)

  const preciseCandidates = new Set(rows.map((row) => row.olid)).size
  const fallbacks = preciseCandidates < FALLBACK_BELOW_CANDIDATES ? plan.fallbacks : []

  // The initial estimate reserved both fallbacks. Once their need is known the
  // total can shrink, but never grow, so the progress bar cannot retreat.
  total = done + fallbacks.length + plan.authors.length

  for (const query of fallbacks) await runQuery(query)
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
