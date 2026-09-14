import type { SemanticProgress } from '../../shared/api'

export const SEMANTIC_MODEL_ID = 'onnx-community/bge-small-en-v1.5-ONNX'
export const SEMANTIC_EMBEDDING_MODEL = `${SEMANTIC_MODEL_ID}:q8:cls:normalized`

export interface SemanticWorkerRequest {
  id: number
  texts: string[]
  cacheDir: string
}

export type SemanticWorkerResponse =
  | { id: number; type: 'progress'; progress: SemanticProgress }
  | { id: number; type: 'result'; vectors: number[][] }
  | { id: number; type: 'error'; message: string }
