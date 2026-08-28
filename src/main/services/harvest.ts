import type { Database } from 'better-sqlite3'

import type { HarvestProgress, HarvestResult } from '../../shared/api'
import { READING_LANGUAGES } from '../../shared/languages'
import { booksWithMetadata, upsertCandidates, type CandidateRow } from '../repos/metadata'
import { enrich } from './library'
import { fetchByAuthor, fetchSubject } from './openlibrary'

// Each unit is about a second of waiting. The backlog cap is tightest because
// an un-enriched book costs up to two requests before harvesting starts.
const MAX_SUBJECTS = 6
const MAX_AUTHORS = 4
const MAX_BACKLOG = 5

// A request costs a second regardless of what it returns, so sixty works cost
// the same as twelve.
const PER_SUBJECT = 60
const PER_AUTHOR = 40

// Where a book sits in a library, not what it is about.
const CATALOGUE =
  /^(accessible book|protected daisy|in library|overdrive|open library staff picks|large type books|lending library|internet archive wishlist)/i

// Matched whole, so "Literature and society" survives.
const BARE_GENERIC =
  /^(fiction|general|novels?|literature|books and reading|english fiction|english literature|american literature)$/i

const NEVER_A_TOPIC =
  /(award|prize winner|reading level|staff picks|bestseller|new york times|long now manual|translation|\blanguage\b)/i

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
    !CATALOGUE.test(s) && !BARE_GENERIC.test(s) && !NEVER_A_TOPIC.test(s) && !FOREIGN_LEAD.test(s)
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

function subjectLabel(subject: string): string {
  return `Books about ${subject}`
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
  let total = missing.length + MAX_SUBJECTS + MAX_AUTHORS
  const report = (label: string): void => onProgress?.({ done, total, label })

  for (const { id } of missing) {
    report('Filling in details for your books')
    await enrich(db, id)
    done += 1
  }

  const liked = booksWithMetadata(db)
    .filter((b) => b.rating === null || b.rating >= 4)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))

  if (liked.length === 0) {
    total = done
    report('Nothing to look for yet')
    return { harvested: 0, offline: false }
  }

  // Filing is refused before the window of twelve, or a book front-loaded with
  // award tags spends half its allowance on them.
  const subjectCounts = new Map<string, number>()
  for (const book of liked) {
    for (const subject of book.subjects.filter(isTopicSubject).slice(0, 12)) {
      const key = subject.trim().toLowerCase()
      subjectCounts.set(key, (subjectCounts.get(key) ?? 0) + 1)
    }
  }

  // A stable sort, so equal counts keep Open Library's own ordering.
  const topSubjects = withoutNearDuplicates(
    [...subjectCounts.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s)
  ).slice(0, MAX_SUBJECTS)

  const topAuthors = [...new Set(liked.map((b) => b.author).filter((a): a is string => !!a))].slice(
    0,
    MAX_AUTHORS
  )

  const rows: CandidateRow[] = []
  let reachedNetwork = false

  total = done + topSubjects.length + topAuthors.length

  for (const subject of topSubjects) {
    report(subjectLabel(subject))
    const found = await fetchSubject(subject, PER_SUBJECT, languages)
    done += 1
    if (found.length > 0) reachedNetwork = true
    for (const b of found) {
      rows.push({
        olid: b.olid,
        title: b.title,
        author: b.author,
        subjects: b.subjects,
        description: null,
        coverId: b.coverId,
        languages: b.languages,
        source: `subject:${subject}`
      })
    }
  }

  for (const author of topAuthors) {
    report(`More by ${author}`)
    const found = await fetchByAuthor(author, PER_AUTHOR, languages)
    done += 1
    if (found.length > 0) reachedNetwork = true
    for (const b of found) {
      rows.push({
        olid: b.olid,
        title: b.title,
        author: b.author,
        subjects: b.subjects,
        description: null,
        coverId: b.coverId,
        languages: b.languages,
        source: `author:${author}`
      })
    }
  }

  report('Sorting what came back')

  const unique = new Map(rows.map((r) => [r.olid, r]))
  const harvested = upsertCandidates(db, [...unique.values()])

  return { harvested, offline: !reachedNetwork && rows.length === 0 }
}
