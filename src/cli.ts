import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { Store } from './db.js';
import { AppError } from './errors.js';
import { analyze, replayWitness } from './kendall.js';
import { LIMITS, type SwapStep } from './types.js';

function parseIds(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) throw new Error();
    return parsed;
  } catch {
    throw new AppError('INVALID_ARGUMENT', '请使用 JSON 字符串数组，例如 \'["A","B"]\'');
  }
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const dbPath = resolve(process.env.DATA_FILE ?? 'data/kendall.sqlite');
  const store = new Store(dbPath);

  try {
    if (command === 'analyze') {
      const source = parseIds(args[0] ?? '[]');
      const target = parseIds(args[1] ?? '[]');
      const budget = Number(args[2] ?? LIMITS.defaultExamples);
      const saved = store.saveAnalysis(analyze({ source, target }, budget));
      console.log(JSON.stringify({ snapshotId: saved.snapshot.id, reportId: saved.report.id, ...saved.report }, null, 2));
    } else if (command === 'get') {
      const report = store.getReport(Number(args[0]));
      if (!report) throw new AppError('NOT_FOUND', '报告不存在');
      console.log(JSON.stringify(report, null, 2));
    } else if (command === 'witness') {
      const report = store.getReport(Number(args[0]));
      if (!report) throw new AppError('NOT_FOUND', '报告不存在');
      console.log(JSON.stringify(report.witness, null, 2));
    } else if (command === 'verify') {
      let steps: SwapStep[];
      let source: string[];
      let target: string[];
      if (args[0]?.endsWith('.json')) {
        const payload = readJsonFile(args[0]) as { source?: string[]; target?: string[]; steps?: SwapStep[] };
        source = payload.source ?? [];
        target = payload.target ?? [];
        steps = payload.steps ?? [];
      } else {
        const report = store.getReport(Number(args[0]));
        if (!report) throw new AppError('NOT_FOUND', '报告不存在');
        source = report.source;
        target = report.target;
        steps = args[1] ? (readJsonFile(args[1]) as { steps: SwapStep[] }).steps : report.witness.steps;
      }
      console.log(JSON.stringify({ valid: true, steps: steps.length, finalOrder: replayWitness(source, target, steps) }, null, 2));
    } else if (command === 'compare') {
      console.log(JSON.stringify(store.compareReports(Number(args[0]), Number(args[1])), null, 2));
    } else if (command === 'list') {
      console.log(JSON.stringify(store.listReports(), null, 2));
    } else if (command === 'export') {
      const report = store.getReport(Number(args[0]));
      if (!report) throw new AppError('NOT_FOUND', '报告不存在');
      const output = args[1] ?? `report-${report.id}.json`;
      writeFileSync(output, JSON.stringify(report, null, 2), 'utf8');
      console.log(`已导出 ${output}`);
    } else {
      console.log(`用法:
  npm run cli -- analyze '["A","B","C"]' '["B","C","A"]'
  npm run cli -- get <reportId>
  npm run cli -- witness <reportId>
  npm run cli -- verify <reportId> [steps.json]
  npm run cli -- compare <leftReportId> <rightReportId>
  npm run cli -- list
  npm run cli -- export <reportId> [output.json]`);
    }
  } finally {
    store.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof AppError) {
    console.error(JSON.stringify({ error: { code: error.code, message: error.message, details: error.details } }, null, 2));
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
