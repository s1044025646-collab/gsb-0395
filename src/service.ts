import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  ALGO_VERSION,
  AppError,
  DistanceResult,
  RankedListInput,
  Witness,
} from "./types.js";
import { normalizeBudget, validateItems, validatePair } from "./validate.js";
import {
  buildRanks,
  countInversions,
  generateWitness,
  normalizedDistance,
} from "./distance.js";

interface SnapshotRow {
  id: string;
  name: string;
  items_json: string;
  created_at: string;
}

interface ReportRow {
  id: string;
  from_snapshot_id: string;
  to_snapshot_id: string;
  from_name: string;
  to_name: string;
  n: number;
  algo_version: string;
  total_pairs: string;
  inversions: string;
  normalized: string;
  evidence_json: string;
  evidence_budget: number;
  evidence_truncated: number;
  from_items_json: string;
  to_items_json: string;
  witness_json: string;
  created_at: string;
}

export class KendallService {
  constructor(private readonly db: DatabaseSync) {}

  createSnapshot(input: RankedListInput): { id: string; name: string; items: string[]; createdAt: string } {
    const name = typeof input?.name === "string" && input.name.trim() ? input.name.trim() : "snapshot";
    const items = validateItems(input?.items, "items");
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare("INSERT INTO snapshots (id, name, items_json, created_at) VALUES (?, ?, ?, ?)")
      .run(id, name, JSON.stringify(items), createdAt);
    return { id, name, items, createdAt };
  }

  getSnapshot(id: string): { id: string; name: string; items: string[]; createdAt: string } {
    const row = this.db.prepare("SELECT * FROM snapshots WHERE id = ?").get(id) as SnapshotRow | undefined;
    if (!row) throw new AppError("NOT_FOUND", `快照不存在：${id}`);
    return { id: row.id, name: row.name, items: JSON.parse(row.items_json), createdAt: row.created_at };
  }

  private readSnapshotList(id: unknown): string[] {
    if (typeof id !== "string") throw new AppError("BAD_REQUEST", "snapshotId 必须是字符串");
    return this.getSnapshot(id).items;
  }

  compute(
    fromInput: RankedListInput | { snapshotId: string },
    toInput: RankedListInput | { snapshotId: string },
    options: { evidenceBudget?: unknown } = {}
  ): DistanceResult {
    const budget = normalizeBudget(options.evidenceBudget);
    const fromItems = "snapshotId" in fromInput ? this.readSnapshotList(fromInput.snapshotId) : validateItems(fromInput.items, "from.items");
    const toItems = "snapshotId" in toInput ? this.readSnapshotList(toInput.snapshotId) : validateItems(toInput.items, "to.items");
    const fromName = "name" in fromInput && typeof fromInput.name === "string" ? fromInput.name : "from";
    const toName = "name" in toInput && typeof toInput.name === "string" ? toInput.name : "to";

    validatePair(fromItems, toItems);

    const n = fromItems.length;
    const ranks = buildRanks(fromItems, toItems);
    const { inversions, evidence, evidenceTruncated } = countInversions(fromItems, ranks, budget);
    const totalPairs = (BigInt(n) * BigInt(n - 1)) / 2n;
    const witness = generateWitness(toItems, ranks);
    const mapping = fromItems.map((id, i) => ({
      id,
      fromPosition: i + 1,
      toPosition: ranks[i]! + 1,
    }));

    const result: DistanceResult = {
      reportId: randomUUID(),
      algoVersion: ALGO_VERSION,
      n,
      fromName,
      toName,
      fromItems,
      toItems,
      mapping,
      totalPairs: totalPairs.toString(),
      inversions: inversions.toString(),
      normalized: normalizedDistance(inversions, n),
      evidence,
      evidenceBudget: budget,
      evidenceTruncated,
      witness,
      createdAt: new Date().toISOString(),
    };

    this.db
      .prepare(
        `INSERT INTO reports (id, from_snapshot_id, to_snapshot_id, from_name, to_name, n,
           algo_version, total_pairs, inversions, normalized, evidence_json, evidence_budget,
           evidence_truncated, from_items_json, to_items_json, witness_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        result.reportId,
        "",
        "",
        fromName,
        toName,
        n,
        ALGO_VERSION,
        result.totalPairs,
        result.inversions,
        result.normalized,
        JSON.stringify(evidence),
        budget,
        evidenceTruncated ? 1 : 0,
        JSON.stringify(fromItems),
        JSON.stringify(toItems),
        JSON.stringify(witness),
        result.createdAt
      );

    return result;
  }

  getReport(id: string): DistanceResult {
    const row = this.db.prepare("SELECT * FROM reports WHERE id = ?").get(id) as ReportRow | undefined;
    if (!row) throw new AppError("NOT_FOUND", `报告不存在：${id}`);
    return this.rowToResult(row);
  }

  listReports(): Array<Pick<DistanceResult, "reportId" | "n" | "inversions" | "normalized" | "createdAt" | "fromName" | "toName" | "algoVersion">> {
    const rows = this.db
      .prepare("SELECT id, n, inversions, normalized, created_at, from_name, to_name, algo_version FROM reports ORDER BY created_at DESC")
      .all() as Array<{
      id: string;
      n: number;
      inversions: string;
      normalized: string;
      created_at: string;
      from_name: string;
      to_name: string;
      algo_version: string;
    }>;
    return rows.map((r) => ({
      reportId: r.id,
      n: r.n,
      inversions: r.inversions,
      normalized: r.normalized,
      createdAt: r.created_at,
      fromName: r.from_name,
      toName: r.to_name,
      algoVersion: r.algo_version,
    }));
  }

  /** 与已有报告比较：距离差值、归一化差值、是否相同输入、算法版本是否一致。 */
  compare(idA: string, idB: string) {
    const a = this.getReport(idA);
    const b = this.getReport(idB);
    const invA = BigInt(a.inversions);
    const invB = BigInt(b.inversions);
    const sameInputs =
      a.n === b.n &&
      a.fromItems.length === b.fromItems.length &&
      a.fromItems.every((x, i) => x === b.fromItems[i]) &&
      a.toItems.every((x, i) => x === b.toItems[i]);
    return {
      reportA: { reportId: a.reportId, n: a.n, inversions: a.inversions, normalized: a.normalized, algoVersion: a.algoVersion },
      reportB: { reportId: b.reportId, n: b.n, inversions: b.inversions, normalized: b.normalized, algoVersion: b.algoVersion },
      inversionDelta: (invA - invB).toString(),
      sameInputs,
      sameAlgoVersion: a.algoVersion === b.algoVersion,
    };
  }

  private rowToResult(row: ReportRow): DistanceResult {
    const fromItems = JSON.parse(row.from_items_json) as string[];
    const toItems = JSON.parse(row.to_items_json) as string[];
    const witness = JSON.parse(row.witness_json) as Witness;
    const mapping = fromItems.map((id, i) => {
      return { id, fromPosition: i + 1, toPosition: toItems.indexOf(id) + 1 };
    });
    return {
      reportId: row.id,
      algoVersion: row.algo_version,
      n: row.n,
      fromName: row.from_name,
      toName: row.to_name,
      fromItems,
      toItems,
      mapping,
      totalPairs: row.total_pairs,
      inversions: row.inversions,
      normalized: row.normalized,
      evidence: JSON.parse(row.evidence_json),
      evidenceBudget: row.evidence_budget,
      evidenceTruncated: row.evidence_truncated === 1,
      witness,
      createdAt: row.created_at,
    };
  }
}
