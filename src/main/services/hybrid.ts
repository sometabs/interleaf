import type { Database } from 'better-sqlite3'

import type {
  Recommendation,
  RecommendationNode,
  RecommendationQuery,
  SemanticProgress
} from '../../shared/api'
import { booksWithMetadata, scorableCandidates } from '../repos/metadata'
import {
  prepareRecommendationRun,
  scoreCandidates,
  type CandidateInput,
  type ProfileBook
} from './recommender'
import {
  buildSemanticTree,
  diversify,
  scoreSemanticCandidates,
  type SemanticEmbedder
} from './semantic'

const RANK_CONSTANT = 60

/** One vote per work per method. Raw similarity scores never cross methods. */
export function reciprocalRankFusion(lists: readonly Recommendation[][]): Recommendation[] {
  const fused = new Map<string, Recommendation>()
  const strongestVote = new Map<string, number>()
  for (const list of lists) {
    const seen = new Set<string>()
    let rank = 0
    for (const recommendation of list) {
      if (seen.has(recommendation.olid)) continue
      seen.add(recommendation.olid)
      const contribution = 1 / (RANK_CONSTANT + ++rank)
      const previous = fused.get(recommendation.olid)
      const best = strongestVote.get(recommendation.olid) ?? 0
      fused.set(recommendation.olid, {
        // Explain the match using the method that ranked this work higher.
        ...(contribution >= best ? recommendation : previous!),
        score: (previous?.score ?? 0) + contribution,
        scoreKind: 'fusion'
      })
      strongestVote.set(recommendation.olid, Math.max(best, contribution))
    }
  }
  return [...fused.values()].sort(
    (left, right) => right.score - left.score || left.olid.localeCompare(right.olid)
  )
}

async function runHybrid(
  library: ProfileBook[],
  candidates: CandidateInput[],
  query: RecommendationQuery,
  cacheDir: string,
  progress: (progress: SemanticProgress) => void,
  embedder?: SemanticEmbedder
): Promise<{ recommendations: Recommendation[]; vectorsByOlid: Map<string, number[]> }> {
  const run = prepareRecommendationRun(library, candidates, query)
  const standard = scoreCandidates(run.profile, run.candidates, run.now)
  const semantic = await scoreSemanticCandidates(run, query, cacheDir, progress, embedder)
  const fused = reciprocalRankFusion([
    standard.map(({ rec }) => rec),
    semantic.scored.map(({ recommendation }) => recommendation)
  ])
  const scored = fused.map((recommendation) => {
    const vector = semantic.vectorsByOlid.get(recommendation.olid)
    if (!vector) throw new Error('The embedding model returned incomplete candidate vectors.')
    return { recommendation, vector }
  })
  // RRF rank gaps are not cosine distances. Preserve the fused order, applying
  // author/source caps for variety without an extra similarity penalty that
  // could lift an off-topic candidate simply because it is different.
  const recommendations = diversify(
    scored,
    run.limit,
    1,
    run.maxPerAuthor,
    query.likeBookId === undefined ? 1 : 0
  )
  progress({ phase: 'ranking', done: 1, total: 1, label: 'Hybrid ranking is ready' })
  return { recommendations, vectorsByOlid: semantic.vectorsByOlid }
}

export async function hybridRecommend(
  library: ProfileBook[],
  candidates: CandidateInput[],
  query: RecommendationQuery,
  cacheDir: string,
  progress: (progress: SemanticProgress) => void,
  embedder?: SemanticEmbedder
): Promise<Recommendation[]> {
  return (await runHybrid(library, candidates, query, cacheDir, progress, embedder)).recommendations
}

export async function hybridRecommendTree(
  library: ProfileBook[],
  candidates: CandidateInput[],
  query: RecommendationQuery,
  cacheDir: string,
  progress: (progress: SemanticProgress) => void,
  embedder?: SemanticEmbedder
): Promise<RecommendationNode[]> {
  const result = await runHybrid(
    library,
    candidates,
    { ...query, limit: query.limit ?? 24 },
    cacheDir,
    progress,
    embedder
  )
  return buildSemanticTree(result.recommendations, result.vectorsByOlid)
}

export async function suggestHybridRecommendations(
  db: Database,
  query: RecommendationQuery = {},
  cacheDir: string,
  progress: (progress: SemanticProgress) => void
): Promise<Recommendation[]> {
  return hybridRecommend(booksWithMetadata(db), scorableCandidates(db), query, cacheDir, progress)
}

export async function suggestHybridRecommendationTree(
  db: Database,
  query: RecommendationQuery = {},
  cacheDir: string,
  progress: (progress: SemanticProgress) => void
): Promise<RecommendationNode[]> {
  return hybridRecommendTree(
    booksWithMetadata(db),
    scorableCandidates(db),
    query,
    cacheDir,
    progress
  )
}
