import type { Database } from 'better-sqlite3'

import type { Recommendation, RecommendationNode, RecommendationQuery } from '../../shared/api'
import { booksWithMetadata, scorableCandidates } from '../repos/metadata'
import { recommend, recommendTree } from './recommender'

// `recommender.ts` is pure, so something has to fetch the shelf and the pool.
// Here rather than in the IPC handler so tests can reach it.
export function suggest(db: Database, query?: RecommendationQuery): Recommendation[] {
  return recommend(booksWithMetadata(db), scorableCandidates(db), query)
}

export function suggestTree(db: Database, query?: RecommendationQuery): RecommendationNode[] {
  return recommendTree(booksWithMetadata(db), scorableCandidates(db), query)
}
