export const ALGO_VERSION = "kendall-inversions-mergecount/v1";

export const LIMITS = {
  maxElements: 100_000,
  maxIdLength: 200,
  maxEvidenceBudget: 1000,
  witnessThreshold: 50,
} as const;

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "DUPLICATE_ID"
  | "SET_MISMATCH"
  | "NOT_FOUND"
  | "WITNESS_TOO_LARGE"
  | "INVALID_WITNESS"
  | "BAD_REQUEST";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export interface RankedListInput {
  name: string;
  items: string[];
}

export interface MappingEntry {
  id: string;
  fromPosition: number;
  toPosition: number;
}

export interface InversionExample {
  idA: string;
  idB: string;
  fromPositionA: number;
  fromPositionB: number;
  toPositionA: number;
  toPositionB: number;
}

export interface WitnessStep {
  step: number;
  index: number;
  idLeft: string;
  idRight: string;
  fixedPrefix: string[];
}

export interface Witness {
  generated: boolean;
  omitted: boolean;
  reason?: string;
  steps: WitnessStep[];
}

export interface DistanceResult {
  reportId: string;
  algoVersion: string;
  n: number;
  fromName: string;
  toName: string;
  fromItems: string[];
  toItems: string[];
  mapping: MappingEntry[];
  totalPairs: string;
  inversions: string;
  normalized: string;
  evidence: InversionExample[];
  evidenceBudget: number;
  evidenceTruncated: boolean;
  witness: Witness;
  createdAt: string;
}
