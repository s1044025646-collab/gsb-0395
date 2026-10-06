import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function openDatabase(dataDir = process.env.DATA_DIR ?? "data"): DatabaseSync {
  const dir = resolve(dataDir);
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(resolve(dir, "kendall.db"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      items_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      from_snapshot_id TEXT NOT NULL,
      to_snapshot_id TEXT NOT NULL,
      from_name TEXT NOT NULL,
      to_name TEXT NOT NULL,
      n INTEGER NOT NULL,
      algo_version TEXT NOT NULL,
      total_pairs TEXT NOT NULL,
      inversions TEXT NOT NULL,
      normalized TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      evidence_budget INTEGER NOT NULL,
      evidence_truncated INTEGER NOT NULL,
      from_items_json TEXT NOT NULL,
      to_items_json TEXT NOT NULL,
      witness_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

export { dirname };
