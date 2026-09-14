// Loaded only when Semantic ranking is selected. The runtime ships with the
// app, while the model remains an on-demand download in the user's data folder.

import type {
  Recommendation,
  RecommendationNode,
  RecommendationQuery,
  SemanticProgress
} from '../../shared/api'
import { booksWithMetadata, scorableCandidates } from '../repos/metadata'
import {
  prepareRecommendationRun,
  tasteWeight,
  type CandidateInput,
  type ProfileBook
} from './recommender'
import type { Database } from 'better-sqlite3'

type DenseVector = number[]
type Progress = (progress: SemanticProgress) => void
export type SemanticEmbedder = (
  texts: string[],
  cacheDir: string,
  progress: Progress
) => Promise<Map<string, DenseVector>>

// Keep the source metadata intact; this is only the text presented to the
// semantic model. Titles and authors are omitted to match TF-IDF's evidence.
function textOf(book: Pick<ProfileBook, 'subjects' | 'description'>): string | null {
  const parts: string[] = []
  if (book.subjects.length > 0) parts.push(`Subjects: ${book.subjects.join('; ')}`)
  if (book.description?.trim()) parts.push(`Description: ${book.description.trim()}`)
  return parts.length > 0 ? parts.join('\n') : null
}

async function embed(
  texts: string[],
  cacheDir: string,
  progress: Progress
): Promise<Map<string, DenseVector>> {
  const uniqueTexts = [...new Set(texts)]
  // Keep the worker entry point out of unit tests that inject their own
  // embedder, and out of Standard-mode startup.
  const { embedInSemanticWorker } = await import('./semanticWorkerClient')
  const rows = await embedInSemanticWorker(uniqueTexts, cacheDir, progress)
  if (rows.length !== uniqueTexts.length) {
    throw new Error('The embedding worker returned the wrong number of vectors.')
  }

  const vectors = new Map(uniqueTexts.map((text, index) => [text, rows[index]]))
  return new Map(texts.map((text) => [text, vectors.get(text)!]))
}

function cosine(left: DenseVector, right: DenseVector): number {
  let score = 0
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index++) score += left[index] * right[index]
  return score
}

function authorKey(author: string | null): string | null {
  const key = author?.trim().toLowerCase()
  return key || null
}

interface SemanticScored {
  vector: DenseVector
  recommendation: Recommendation
}

interface SemanticRun {
  recommendations: Recommendation[]
  vectorsByOlid: Map<string, DenseVector>
}

function diversify(
  scored: SemanticScored[],
  limit: number,
  lambda: number,
  initialAuthorCap: number,
  initialSourceCap: number
): Recommendation[] {
  const pool = scored.slice(0, Math.max(limit * 5, 50))
  const chosen: SemanticScored[] = []
  const authorsSeen = new Map<string, number>()
  const sourcesSeen = new Map<number, number>()
  let authorCap = initialAuthorCap
  let sourceCap = initialSourceCap

  while (chosen.length < limit && pool.length > 0) {
    let bestIndex = -1
    let bestValue = -Infinity

    pool.forEach((item, index) => {
      const key = authorKey(item.recommendation.author)
      if (authorCap > 0 && key !== null && (authorsSeen.get(key) ?? 0) >= authorCap) {
        return
      }
      const source = item.recommendation.becauseOf?.bookId
      if (sourceCap > 0 && source !== undefined && (sourcesSeen.get(source) ?? 0) >= sourceCap) {
        return
      }

      let nearest = 0
      for (const previous of chosen) {
        nearest = Math.max(nearest, cosine(item.vector, previous.vector))
      }
      const value = lambda * item.recommendation.score - (1 - lambda) * nearest
      if (value > bestValue) {
        bestValue = value
        bestIndex = index
      }
    })

    if (bestIndex === -1) {
      if (sourceCap > 0) sourceCap += 1
      if (authorCap > 0) authorCap += 1
      if (sourceCap <= 0 && authorCap <= 0) break
      continue
    }

    const selected = pool.splice(bestIndex, 1)[0]
    for (let index = pool.length - 1; index >= 0; index--) {
      if (pool[index].recommendation.olid === selected.recommendation.olid) pool.splice(index, 1)
    }
    const key = authorKey(selected.recommendation.author)
    if (key !== null) authorsSeen.set(key, (authorsSeen.get(key) ?? 0) + 1)
    const source = selected.recommendation.becauseOf?.bookId
    if (source !== undefined) sourcesSeen.set(source, (sourcesSeen.get(source) ?? 0) + 1)
    chosen.push(selected)
  }

  return chosen.map((item) => item.recommendation)
}

async function runSemanticRecommendation(
  library: ProfileBook[],
  candidates: CandidateInput[],
  query: RecommendationQuery,
  cacheDir: string,
  progress: Progress,
  embedder: SemanticEmbedder = embed
): Promise<SemanticRun> {
  const run = prepareRecommendationRun(library, candidates, query)
  const profileEntries = run.profile.flatMap((book) => {
    const text = textOf(book)
    return text ? [{ book, text }] : []
  })
  const candidateEntries = run.candidates.flatMap((candidate) => {
    const text = textOf(candidate)
    return text ? [{ candidate, text }] : []
  })

  if (profileEntries.length === 0 || candidateEntries.length === 0) {
    return { recommendations: [], vectorsByOlid: new Map() }
  }

  const weightedProfile = profileEntries.map((entry) => ({
    ...entry,
    weight: tasteWeight(entry.book, run.now)
  }))
  const positiveProfile = weightedProfile.filter(({ weight }) => weight > 0)
  const negativeProfile = weightedProfile.filter(({ weight }) => weight < 0)
  if (positiveProfile.length === 0) {
    return { recommendations: [], vectorsByOlid: new Map() }
  }

  const vectors = await embedder(
    [...profileEntries.map(({ text }) => text), ...candidateEntries.map(({ text }) => text)],
    cacheDir,
    progress
  )

  const strongestPositiveWeight = Math.max(...positiveProfile.map(({ weight }) => weight))

  progress({ phase: 'ranking', done: 0, total: 1, label: 'Ranking advanced matches…' })
  const matchedCandidates = candidateEntries.map(({ candidate, text }) => {
    const vector = vectors.get(text)!
    const matches = positiveProfile.map((profile) => ({
      profile,
      similarity: cosine(vectors.get(profile.text)!, vector)
    }))
    const strongestRawPositive = Math.max(...matches.map(({ similarity }) => similarity))
    const strongestNegative = negativeProfile.reduce((highest, profile) => {
      const similarity = cosine(vectors.get(profile.text)!, vector)
      return Math.max(highest, similarity * Math.min(1, Math.abs(profile.weight) / 0.75))
    }, 0)

    return {
      candidate,
      vector,
      matches,
      negativePenalty: Math.max(0, strongestNegative - strongestRawPositive) * 0.5
    }
  })

  let scored: SemanticScored[]
  if (query.likeBookId !== undefined) {
    const source = positiveProfile[0]
    scored = matchedCandidates.map((item) => ({
      vector: item.vector,
      recommendation: {
        olid: item.candidate.olid,
        title: item.candidate.title,
        author: item.candidate.author,
        coverId: item.candidate.coverId,
        score: item.matches[0].similarity - item.negativePenalty,
        becauseOf: { bookId: source.book.bookId, title: source.book.title },
        subjects: [...item.candidate.subjects]
      }
    }))
  } else {
    // Each library book gets its own ranking before those interest lanes are
    // merged. This removes cross-book score-scale bias without averaging tastes.
    const proposalsPerSource = Math.min(matchedCandidates.length, Math.max(run.limit * 3, 30))
    scored = positiveProfile.flatMap((source, sourceIndex) => {
      const ranked = [...matchedCandidates]
        .sort(
          (left, right) =>
            right.matches[sourceIndex].similarity - left.matches[sourceIndex].similarity
        )
        .slice(0, proposalsPerSource)

      return ranked.map((item, rank) => {
        const similarity = item.matches[sourceIndex].similarity
        const rankQuality = 1 - rank / proposalsPerSource
        const supportingMatches = [...item.matches]
          .sort((left, right) => right.similarity - left.similarity)
          .slice(0, 3)
        const support =
          supportingMatches.reduce((sum, match) => sum + match.similarity, 0) /
          supportingMatches.length
        const ratingStrength = source.weight / strongestPositiveWeight

        return {
          vector: item.vector,
          recommendation: {
            olid: item.candidate.olid,
            title: item.candidate.title,
            author: item.candidate.author,
            coverId: item.candidate.coverId,
            score:
              ratingStrength * similarity * (rankQuality * 0.75 + 0.2 + support * 0.05) -
              item.negativePenalty,
            becauseOf: { bookId: source.book.bookId, title: source.book.title },
            subjects: [...item.candidate.subjects]
          }
        }
      })
    })
  }

  scored = scored
    .filter(({ recommendation }) => recommendation.score > 0)
    .sort((left, right) => right.recommendation.score - left.recommendation.score)

  const recommendations = diversify(
    scored,
    run.limit,
    run.diversity,
    run.maxPerAuthor,
    query.likeBookId === undefined ? 1 : 0
  )
  progress({ phase: 'ranking', done: 1, total: 1, label: 'Advanced ranking is ready' })
  return {
    recommendations,
    vectorsByOlid: new Map(
      matchedCandidates.map(({ candidate, vector }) => [candidate.olid, vector])
    )
  }
}

function buildSemanticTree(
  recommendations: Recommendation[],
  vectorsByOlid: Map<string, DenseVector>
): RecommendationNode[] {
  const roots: RecommendationNode[] = []
  const placed: { vector: DenseVector; node: RecommendationNode }[] = []

  // Place the strongest matches first so a branch always grows away from the
  // taste profile, then attach each later book to its closest semantic peer.
  for (const recommendation of [...recommendations].sort((a, b) => b.score - a.score)) {
    const vector = vectorsByOlid.get(recommendation.olid)
    let parent: { vector: DenseVector; node: RecommendationNode } | null = null
    let best = 0

    if (vector) {
      for (const other of placed) {
        const similarity = cosine(vector, other.vector)
        if (similarity > best) {
          best = similarity
          parent = other
        }
      }
    }

    const node: RecommendationNode = {
      ...recommendation,
      similarityToParent: parent ? Math.min(1, best) : null,
      depth: parent ? parent.node.depth + 1 : 0,
      children: []
    }

    if (parent) parent.node.children.push(node)
    else roots.push(node)
    if (vector) placed.push({ vector, node })
  }

  return roots
}

export async function semanticRecommend(
  library: ProfileBook[],
  candidates: CandidateInput[],
  query: RecommendationQuery,
  cacheDir: string,
  progress: Progress,
  embedder: SemanticEmbedder = embed
): Promise<Recommendation[]> {
  return (await runSemanticRecommendation(library, candidates, query, cacheDir, progress, embedder))
    .recommendations
}

export async function semanticRecommendTree(
  library: ProfileBook[],
  candidates: CandidateInput[],
  query: RecommendationQuery,
  cacheDir: string,
  progress: Progress,
  embedder: SemanticEmbedder = embed
): Promise<RecommendationNode[]> {
  const run = await runSemanticRecommendation(
    library,
    candidates,
    query,
    cacheDir,
    progress,
    embedder
  )
  return buildSemanticTree(run.recommendations, run.vectorsByOlid)
}

export async function suggestSemanticRecommendations(
  db: Database,
  query: RecommendationQuery = {},
  cacheDir: string,
  progress: Progress
): Promise<Recommendation[]> {
  return semanticRecommend(booksWithMetadata(db), scorableCandidates(db), query, cacheDir, progress)
}

export async function suggestSemanticRecommendationTree(
  db: Database,
  query: RecommendationQuery = {},
  cacheDir: string,
  progress: Progress
): Promise<RecommendationNode[]> {
  return semanticRecommendTree(
    booksWithMetadata(db),
    scorableCandidates(db),
    query,
    cacheDir,
    progress
  )
}
