// TF-IDF over subjects and descriptions, cosine similarity, then MMR for
// diversity. Pure functions: no database, no network.

import type {
  Recommendation,
  RecommendationNode,
  RecommendationQuery,
  RecommendationScope
} from '../../shared/api'

export interface ProfileBook {
  bookId: number
  title: string
  author: string | null
  // Optional so the pure recommender stays convenient for synthetic callers.
  // Database-backed profiles always provide it.
  status?: 'want' | 'reading' | 'read' | 'abandoned'
  rating: number | null
  subjects: string[]
  description: string | null
  finishedAt: number | null
}

export interface CandidateInput {
  olid: string
  title: string
  author: string | null
  subjects: string[]
  description: string | null
  coverId: number | null
  languages: string[]
}

// Too common in book blurbs to carry signal.
const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'have',
  'has',
  'was',
  'were',
  'are',
  'but',
  'not',
  'you',
  'your',
  'all',
  'can',
  'his',
  'her',
  'him',
  'she',
  'they',
  'them',
  'their',
  'its',
  'into',
  'out',
  'who',
  'what',
  'when',
  'where',
  'which',
  'while',
  'about',
  'after',
  'before',
  'between',
  'through',
  'during',
  'book',
  'novel',
  'story',
  'stories',
  'tale',
  'tales',
  'author',
  'fiction',
  'nonfiction',
  'edition',
  'first',
  'new',
  'one',
  'two',
  'three',
  'other',
  'more',
  'most',
  'some',
  'any',
  'each',
  'also',
  'than',
  'then',
  'there',
  'these',
  'those',
  'such',
  'only',
  'own',
  'same',
  'too',
  'very',
  'just',
  'over',
  'under',
  'again',
  'once',
  'here',
  'how',
  'why',
  'been',
  'being',
  'had',
  'did',
  'does',
  'doing',
  'would',
  'could',
  'should',
  'will',
  'shall',
  'may',
  'might',
  'must',
  'life',
  'world',
  'man',
  'woman',
  'young',
  'great',
  'little'
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3 && t.length <= 24 && !STOPWORDS.has(t) && !/^\d+$/.test(t))
}

// Subjects are repeated because curated metadata beats marketing blurb.
const SUBJECT_WEIGHT = 3

function termsOf(subjects: string[], description: string | null): string[] {
  const terms: string[] = []

  // Every Open Library subject participates exactly as returned. TF-IDF makes
  // ubiquitous catalogue terms weak without rewriting or dropping metadata.
  for (const subject of subjects) {
    const tokens = tokenize(subject)
    for (let i = 0; i < SUBJECT_WEIGHT; i++) terms.push(...tokens)
  }

  if (description) terms.push(...tokenize(description).slice(0, 250))
  return terms
}

type Vector = Map<string, number>

function termFrequency(terms: string[]): Vector {
  const tf: Vector = new Map()
  for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1)
  return tf
}

function buildIdf(docs: Vector[]): Vector {
  const df: Vector = new Map()
  for (const doc of docs) {
    for (const term of doc.keys()) df.set(term, (df.get(term) ?? 0) + 1)
  }

  const idf: Vector = new Map()
  const n = docs.length || 1
  for (const [term, count] of df) {
    idf.set(term, Math.log((n + 1) / (count + 1)) + 1)
  }
  return idf
}

function applyIdf(tf: Vector, idf: Vector): Vector {
  const out: Vector = new Map()
  for (const [term, freq] of tf) {
    const weight = idf.get(term)
    if (weight !== undefined) out.set(term, (1 + Math.log(freq)) * weight)
  }
  return normalize(out)
}

function normalize(v: Vector): Vector {
  let sum = 0
  for (const x of v.values()) sum += x * x
  const mag = Math.sqrt(sum)
  if (mag === 0) return v

  const out: Vector = new Map()
  for (const [k, x] of v) out.set(k, x / mag)
  return out
}

function cosine(a: Vector, b: Vector): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  let dot = 0
  for (const [term, weight] of small) {
    const other = large.get(term)
    if (other !== undefined) dot += weight * other
  }
  return dot
}

// A low rating pushes away, not merely less towards.
export function tasteWeight(book: ProfileBook, now: number): number {
  const base =
    book.rating === null
      ? 0.5
      : book.rating >= 4
        ? book.rating - 3 // 4 -> 1, 5 -> 2
        : book.rating <= 2
          ? -0.75 // actively disliked
          : 0.25

  if (base <= 0 || !book.finishedAt) return base

  // Half-life ~2 years: recent reading is the better signal of current taste.
  const years = (now - book.finishedAt) / (365.25 * 24 * 3600)
  return base * (0.5 + 0.5 * Math.pow(0.5, Math.max(0, years) / 2))
}

export interface RecommendOptions extends RecommendationQuery {
  // Optional for pure callers. The app's candidate harvest already filters to
  // English at Open Library, so scoring does not need to repeat that filter.
  languages?: readonly string[]
  // 0 = maximum diversity, 1 = pure relevance.
  diversity?: number
  // 0 or below disables the cap.
  maxPerAuthor?: number
  now?: number
}

// The per-author cap is lifted here: crowding by one writer is what was asked.
function inScope(
  library: ProfileBook[],
  candidates: CandidateInput[],
  scope: RecommendationScope
): CandidateInput[] {
  if (scope !== 'same-authors') return candidates

  const known = new Set<string>()
  for (const book of library) {
    const key = authorKey(book.author)
    if (key !== null) known.add(key)
  }

  return candidates.filter((candidate) => {
    const key = authorKey(candidate.author)
    return key !== null && known.has(key)
  })
}

// A candidate recording no language is dropped, or "English and French" would
// mean "and anything unlabelled".
function byLanguage(candidates: CandidateInput[], languages: readonly string[]): CandidateInput[] {
  if (languages.length === 0) return candidates

  const readable = new Set(languages)
  return candidates.filter((candidate) =>
    candidate.languages.some((code) => readable.has(code.toLowerCase()))
  )
}

// The rating is overridden because a disliked book weighs negative, and a
// profile of one such book is emptied rather than pointed at.
function profileFor(library: ProfileBook[], options: RecommendOptions): ProfileBook[] {
  if (options.likeBookId === undefined) {
    return library.filter((book) => {
      if (book.rating === null) return false
      // A low rating is explicit negative evidence even when the book was set
      // aside. Positive and neutral evidence must come from a finished book.
      return book.rating <= 2 || book.status === undefined || book.status === 'read'
    })
  }

  const book = library.find((entry) => entry.bookId === options.likeBookId)
  return book ? [{ ...book, rating: 5 }] : []
}

// In one place so the list and the tree narrow identically.
function poolFor(
  library: ProfileBook[],
  candidates: CandidateInput[],
  options: RecommendOptions
): CandidateInput[] {
  return byLanguage(inScope(library, candidates, options.scope ?? 'all'), options.languages ?? [])
}

function capFor(options: RecommendOptions): number {
  if (options.maxPerAuthor !== undefined) return options.maxPerAuthor
  return options.scope === 'same-authors' ? 0 : DEFAULT_MAX_PER_AUTHOR
}

// MMR cannot do this: at lambda 0.7 a perfect duplicate still beats a book with
// 3.5x less relevance, and a series tag acts as an author fingerprint.
const DEFAULT_MAX_PER_AUTHOR = 2

export interface RecommendationRun {
  profile: ProfileBook[]
  candidates: CandidateInput[]
  now: number
  limit: number
  diversity: number
  maxPerAuthor: number
}

// Both ranking methods must start from exactly the same evidence and pool.
// Keeping this here prevents semantic scoring from quietly changing shelf,
// language, author or single-book behavior while it is being compared.
export function prepareRecommendationRun(
  library: ProfileBook[],
  candidates: CandidateInput[],
  options: RecommendOptions = {}
): RecommendationRun {
  const profile = profileFor(library, options)
  return {
    profile,
    candidates: poolFor(profile, candidates, options),
    now: options.now ?? Math.floor(Date.now() / 1000),
    limit: options.limit ?? 12,
    diversity: options.diversity ?? 0.7,
    maxPerAuthor: capFor(options)
  }
}

// Open Library spells the same author inconsistently across editions.
function authorKey(author: string | null): string | null {
  const key = author?.trim().toLowerCase()
  return key ? key : null
}

function underCap(author: string | null, seen: Map<string, number>, cap: number): boolean {
  if (cap <= 0) return true
  const key = authorKey(author)
  return key === null || (seen.get(key) ?? 0) < cap
}

function countAuthor(author: string | null, seen: Map<string, number>): void {
  const key = authorKey(author)
  if (key !== null) seen.set(key, (seen.get(key) ?? 0) + 1)
}

interface Scored {
  vec: Vector
  rec: Recommendation
}

// Shared by `recommend` and `recommendTree` so the ranking cannot drift, and
// each vector is kept so callers can compare candidates to each other.
function scoreCandidates(
  library: ProfileBook[],
  candidates: CandidateInput[],
  now: number
): Scored[] {
  if (library.length === 0 || candidates.length === 0) return []

  const libraryTf = library.map((b) => termFrequency(termsOf(b.subjects, b.description)))
  const candidateTf = candidates.map((c) => termFrequency(termsOf(c.subjects, c.description)))

  const idf = buildIdf([...libraryTf, ...candidateTf])

  const libraryVecs = libraryTf.map((tf) => applyIdf(tf, idf))
  const candidateVecs = candidateTf.map((tf) => applyIdf(tf, idf))

  const profile: Vector = new Map()
  let anyWeight = false
  library.forEach((book, i) => {
    const w = tasteWeight(book, now)
    if (w === 0) return
    anyWeight = true
    for (const [term, value] of libraryVecs[i]) {
      profile.set(term, (profile.get(term) ?? 0) + value * w)
    }
  })
  if (!anyWeight) return []

  for (const [term, value] of profile) if (value <= 0) profile.delete(term)
  const profileVec = normalize(profile)
  if (profileVec.size === 0) return []

  return candidates
    .map((candidate, i) => {
      const vec = candidateVecs[i]
      const score = cosine(profileVec, vec)

      let bestIdx = -1
      let bestSim = 0
      libraryVecs.forEach((libVec, j) => {
        if (tasteWeight(library[j], now) <= 0) return
        const sim = cosine(libVec, vec)
        if (sim > bestSim) {
          bestSim = sim
          bestIdx = j
        }
      })

      return {
        vec,
        rec: {
          olid: candidate.olid,
          title: candidate.title,
          author: candidate.author,
          coverId: candidate.coverId,
          score,
          becauseOf:
            bestIdx >= 0
              ? { bookId: library[bestIdx].bookId, title: library[bestIdx].title }
              : null,
          subjects: [...candidate.subjects]
        } satisfies Recommendation
      }
    })
    .filter((r) => r.rec.score > 0)
    .sort((a, b) => b.rec.score - a.rec.score)
}

export function recommend(
  library: ProfileBook[],
  candidates: CandidateInput[],
  options: RecommendOptions = {}
): Recommendation[] {
  const run = prepareRecommendationRun(library, candidates, options)
  const scored = scoreCandidates(run.profile, run.candidates, run.now)

  return maximalMarginalRelevance(scored, run.limit, run.diversity, run.maxPerAuthor)
}

// Inserted best-first so a parent is always nearer to the profile than its
// children. No MMR: in a tree those variations become a visible branch.
export function recommendTree(
  library: ProfileBook[],
  candidates: CandidateInput[],
  options: RecommendOptions = {}
): RecommendationNode[] {
  const run = prepareRecommendationRun(library, candidates, {
    ...options,
    limit: options.limit ?? 24
  })

  // Re-sorted by score after the cap: insertion order is what makes depth
  // mean distance.
  const scored = takeCappedByAuthor(
    scoreCandidates(run.profile, run.candidates, run.now),
    run.limit,
    run.maxPerAuthor
  ).sort((a, b) => b.rec.score - a.rec.score)

  const roots: RecommendationNode[] = []
  const placed: { vec: Vector; node: RecommendationNode }[] = []

  for (const item of scored) {
    let parent: { vec: Vector; node: RecommendationNode } | null = null
    let best = 0

    for (const other of placed) {
      const similarity = cosine(item.vec, other.vec)
      if (similarity > best) {
        best = similarity
        parent = other
      }
    }

    const node: RecommendationNode = {
      ...item.rec,
      similarityToParent: parent ? best : null,
      depth: parent ? parent.node.depth + 1 : 0,
      children: []
    }

    if (parent) parent.node.children.push(node)
    else roots.push(node)

    placed.push({ vec: item.vec, node })
  }

  return roots
}

// No vector diversity here: the tree wants its clusters, just not one author's.
function takeCappedByAuthor(scored: Scored[], limit: number, cap: number): Scored[] {
  const pool = scored.slice(0, Math.max(limit * 5, 50))
  const chosen: Scored[] = []
  const authorsSeen = new Map<string, number>()
  let allowed = cap

  while (chosen.length < limit && pool.length > 0) {
    const index = pool.findIndex((item) => underCap(item.rec.author, authorsSeen, allowed))
    if (index === -1) {
      allowed += 1
      continue
    }

    const picked = pool.splice(index, 1)[0]
    countAuthor(picked.rec.author, authorsSeen)
    chosen.push(picked)
  }

  return chosen
}

// Greedy MMR: without it a library heavy on one subject returns ten
// near-identical books.
function maximalMarginalRelevance(
  scored: { vec: Vector; rec: Recommendation }[],
  limit: number,
  lambda: number,
  cap: number
): Recommendation[] {
  const pool = scored.slice(0, Math.max(limit * 5, 50))
  const chosen: { vec: Vector; rec: Recommendation }[] = []
  const authorsSeen = new Map<string, number>()
  let allowed = cap

  while (chosen.length < limit && pool.length > 0) {
    let bestIdx = -1
    let bestValue = -Infinity

    pool.forEach((item, i) => {
      // Before the trade-off, so no amount of relevance buys a third slot.
      if (!underCap(item.rec.author, authorsSeen, allowed)) return

      let maxSim = 0
      for (const picked of chosen) {
        const sim = cosine(item.vec, picked.vec)
        if (sim > maxSim) maxSim = sim
      }
      const value = lambda * item.rec.score - (1 - lambda) * maxSim
      if (value > bestValue) {
        bestValue = value
        bestIdx = i
      }
    })

    if (bestIdx === -1) {
      allowed += 1
      continue
    }

    const picked = pool.splice(bestIdx, 1)[0]
    countAuthor(picked.rec.author, authorsSeen)
    chosen.push(picked)
  }

  return chosen.map((c) => c.rec)
}
