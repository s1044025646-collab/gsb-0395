import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { AppError } from './errors.js';
import type { DistanceResult, StoredReport, StoredSnapshot } from './types.js';

export class Store {
  private readonly db: DatabaseSync;

  constructor(dbPath = resolve('data/kendall.sqlite')) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_json TEXT NOT NULL,
        target_json TEXT NOT NULL,
        input_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_id INTEGER NOT NULL UNIQUE,
        algorithm_version TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (snapshot_id) REFERENCES snapshots(id)
      );
    `);
  }

  close() {
    this.db.close();
  }

  private static hash(source: string[], target: string[]) {
    return createHash('sha256').update(JSON.stringify({ source, target })).digest('hex');
  }

  saveAnalysis(result: DistanceResult): { snapshot: StoredSnapshot; report: StoredReport; reused: boolean } {
    const sourceJson = JSON.stringify(result.source);
    const targetJson = JSON.stringify(result.target);
    const inputHash = Store.hash(result.source, result.target);
    const existing = this.db
      .prepare('SELECT snapshot_id, id AS report_id, result_json, created_at AS report_created FROM reports JOIN snapshots ON snapshots.id = reports.snapshot_id WHERE input_hash = ?')
      .get(inputHash) as
      | { snapshot_id: number; report_id: number; result_json: string; report_created: string }
      | undefined;

    if (existing) {
      return {
        snapshot: this.getSnapshot(existing.snapshot_id)!,
        report: this.deserializeReport(existing.report_id, existing.snapshot_id, existing.report_created, existing.result_json),
        reused: true
      };
    }

    try {
      const snapshotInfo = this.db
        .prepare('INSERT INTO snapshots (source_json, target_json, input_hash) VALUES (?, ?, ?)')
        .run(sourceJson, targetJson, inputHash);
      const snapshotId = Number(snapshotInfo.lastInsertRowid);
      const reportInfo = this.db
        .prepare('INSERT INTO reports (snapshot_id, algorithm_version, result_json) VALUES (?, ?, ?)')
        .run(snapshotId, result.algorithmVersion, JSON.stringify(result));
      return {
        snapshot: this.getSnapshot(snapshotId)!,
        report: this.getReport(Number(reportInfo.lastInsertRowid))!,
        reused: false
      };
    } catch (error) {
      throw new AppError('INVALID_ARGUMENT', '保存分析失败', { cause: String(error) });
    }
  }

  private deserializeReport(id: number, snapshotId: number, createdAt: string, resultJson: string): StoredReport {
    return { id, snapshot_id: snapshotId, created_at: createdAt, ...(JSON.parse(resultJson) as DistanceResult) };
  }

  getSnapshot(id: number): StoredSnapshot | undefined {
    const row = this.db
      .prepare('SELECT id, source_json, target_json, created_at FROM snapshots WHERE id = ?')
      .get(id) as { id: number; source_json: string; target_json: string; created_at: string } | undefined;
    if (!row) return undefined;
    return { id: row.id, source: JSON.parse(row.source_json), target: JSON.parse(row.target_json), created_at: row.created_at };
  }

  getReport(id: number): StoredReport | undefined {
    const row = this.db
      .prepare('SELECT id, snapshot_id, result_json, created_at FROM reports WHERE id = ?')
      .get(id) as { id: number; snapshot_id: number; result_json: string; created_at: string } | undefined;
    return row ? this.deserializeReport(row.id, row.snapshot_id, row.created_at, row.result_json) : undefined;
  }

  listReports(): Array<{ id: number; snapshot_id: number; n: number; inversions: string; created_at: string }> {
    const rows = this.db
      .prepare('SELECT reports.id, snapshot_id, result_json, reports.created_at FROM reports ORDER BY reports.id')
      .all() as Array<{ id: number; snapshot_id: number; result_json: string; created_at: string }>;
    return rows.map((row) => {
      const result = JSON.parse(row.result_json) as DistanceResult;
      return { id: row.id, snapshot_id: row.snapshot_id, n: result.n, inversions: result.inversions, created_at: row.created_at };
    });
  }

  compareReports(leftId: number, rightId: number) {
    const left = this.getReport(leftId);
    const right = this.getReport(rightId);
    if (!left) throw new AppError('NOT_FOUND', `报告 ${leftId} 不存在`);
    if (!right) throw new AppError('NOT_FOUND', `报告 ${rightId} 不存在`);
    const delta = BigInt(left.inversions) - BigInt(right.inversions);
    return {
      leftReportId: left.id,
      rightReportId: right.id,
      leftInversions: left.inversions,
      rightInversions: right.inversions,
      delta: delta.toString(),
      sameInput: JSON.stringify(left.source) === JSON.stringify(right.source) && JSON.stringify(left.target) === JSON.stringify(right.target)
    };
  }
}
