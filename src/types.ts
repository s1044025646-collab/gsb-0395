export type ErrorCode =
  | 'INVALID_ARGUMENT'
  | 'DUPLICATE_ID'
  | 'SET_MISMATCH'
  | 'TOO_LARGE'
  | 'ID_TOO_LONG'
  | 'WITNESS_TOO_LARGE'
  | 'NOT_FOUND'
  | 'INVALID_WITNESS';

export interface ValidationIssue {
  code: ErrorCode;
  message: string;
  field?: string;
  details?: unknown;
}

export interface KendallInput {
  source: string[];
  target: string[];
}

export interface InversionExample {
  idA: string;
  idB: string;
  sourcePositionA: number;
  sourcePositionB: number;
  targetPositionA: number;
  targetPositionB: number;
}

export interface SwapStep {
  step: number;
  leftPosition: number;
  rightPosition: number;
  leftId: string;
  rightId: string;
  fixedPrefix: string[];
}

export interface Witness {
  generated: boolean;
  reason?: string;
  steps: SwapStep[];
}

export interface DistanceResult {
  n: number;
  source: string[];
  target: string[];
  mappedPositions: number[];
  targetPositions: Record<string, number>;
  totalPairs: string;
  inversions: string;
  normalizedDistance: string;
  examples: InversionExample[];
  witness: Witness;
  algorithmVersion: string;
}

export interface StoredSnapshot {
  id: number;
  source: string[];
  target: string[];
  created_at: string;
}

export interface StoredReport extends DistanceResult {
  id: number;
  snapshot_id: number;
  created_at: string;
}

export const LIMITS = {
  maxElements: 100_000,
  maxIdLength: 200,
  maxExamples: 100,
  witnessMaxElements: 50,
  defaultExamples: 10 as number
} as const;

export const ALGORITHM_VERSION = 'merge-bigint-v1';
