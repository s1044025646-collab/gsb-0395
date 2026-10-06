import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { Store } from './db.js';
import { AppError } from './errors.js';
import { analyze, replayWitness, validateInput } from './kendall.js';
import { LIMITS, type SwapStep } from './types.js';

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body, null, 2));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError('INVALID_ARGUMENT', '请求体必须是合法 JSON');
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function createApp(store: Store): Server {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const method = request.method ?? 'GET';
      const pathParts = url.pathname.split('/').filter(Boolean);

      if (method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, { ok: true, limits: LIMITS });
        return;
      }

      if (method === 'POST' && url.pathname === '/analyses') {
        const body = asObject(await readJson(request));
        const exampleBudget = body.exampleBudget === undefined ? LIMITS.defaultExamples : Number(body.exampleBudget);
        const result = analyze({ source: body.source as string[], target: body.target as string[] }, exampleBudget);
        const saved = store.saveAnalysis(result);
        sendJson(response, saved.reused ? 200 : 201, {
          ...saved.report,
          snapshot: saved.snapshot,
          reusedSnapshot: saved.reused
        });
        return;
      }

      if (method === 'GET' && pathParts[0] === 'reports' && pathParts.length === 2) {
        const report = store.getReport(Number(pathParts[1]));
        if (!report) throw new AppError('NOT_FOUND', '报告不存在');
        sendJson(response, 200, report);
        return;
      }

      if (method === 'GET' && pathParts[0] === 'reports' && pathParts.length === 3 && pathParts[2] === 'mapping') {
        const report = store.getReport(Number(pathParts[1]));
        if (!report) throw new AppError('NOT_FOUND', '报告不存在');
        sendJson(response, 200, {
          reportId: report.id,
          n: report.n,
          targetPositions: report.targetPositions,
          mappedPositions: report.mappedPositions
        });
        return;
      }

      if (method === 'GET' && pathParts[0] === 'reports' && pathParts.length === 3 && pathParts[2] === 'examples') {
        const report = store.getReport(Number(pathParts[1]));
        if (!report) throw new AppError('NOT_FOUND', '报告不存在');
        const limit = Math.min(Number(url.searchParams.get('limit') ?? String(report.examples.length)), LIMITS.maxExamples);
        sendJson(response, 200, { reportId: report.id, inversions: report.inversions, examples: report.examples.slice(0, limit) });
        return;
      }

      if (method === 'GET' && pathParts[0] === 'reports' && pathParts.length === 3 && pathParts[2] === 'witness') {
        const report = store.getReport(Number(pathParts[1]));
        if (!report) throw new AppError('NOT_FOUND', '报告不存在');
        sendJson(response, 200, { reportId: report.id, witness: report.witness });
        return;
      }

      if (method === 'POST' && pathParts[0] === 'reports' && pathParts.length === 3 && pathParts[2] === 'verify-witness') {
        const report = store.getReport(Number(pathParts[1]));
        if (!report) throw new AppError('NOT_FOUND', '报告不存在');
        const body = asObject(await readJson(request));
        const steps = (body.steps ?? report.witness.steps) as SwapStep[];
        if (!Array.isArray(steps)) throw new AppError('INVALID_ARGUMENT', 'steps 必须是数组');
        const finalOrder = replayWitness(report.source, report.target, steps);
        sendJson(response, 200, { valid: true, steps: steps.length, finalOrder });
        return;
      }

      if (method === 'POST' && url.pathname === '/witness/verify') {
        const body = asObject(await readJson(request));
        const input = validateInput({ source: body.source as string[], target: body.target as string[] });
        const steps = body.steps;
        if (!Array.isArray(steps)) throw new AppError('INVALID_ARGUMENT', 'steps 必须是数组');
        const finalOrder = replayWitness(input.source, input.target, steps as SwapStep[]);
        sendJson(response, 200, { valid: true, steps: steps.length, finalOrder });
        return;
      }

      if (method === 'GET' && url.pathname === '/reports') {
        sendJson(response, 200, { reports: store.listReports() });
        return;
      }

      if (method === 'GET' && pathParts[0] === 'compare' && pathParts.length === 1) {
        const left = Number(url.searchParams.get('left'));
        const right = Number(url.searchParams.get('right'));
        if (!Number.isInteger(left) || !Number.isInteger(right)) throw new AppError('INVALID_ARGUMENT', 'compare 需要整数 left 和 right 查询参数');
        sendJson(response, 200, store.compareReports(left, right));
        return;
      }

      if (method === 'GET' && pathParts[0] === 'reports' && pathParts.length === 3 && pathParts[2] === 'export') {
        const report = store.getReport(Number(pathParts[1]));
        if (!report) throw new AppError('NOT_FOUND', '报告不存在');
        response.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="report-${report.id}.json"`
        });
        response.end(JSON.stringify(report, null, 2));
        return;
      }

      sendJson(response, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } });
    } catch (error) {
      if (error instanceof AppError) {
        sendJson(response, error.status, { error: { code: error.code, message: error.message, details: error.details } });
      } else {
        sendJson(response, 500, { error: { code: 'INTERNAL', message: error instanceof Error ? error.message : '未知错误' } });
      }
    }
  });
}

export function startServer(port = Number(process.env.PORT ?? 0), dbPath = resolve('data/kendall.sqlite')) {
  const store = new Store(dbPath);
  const server = createApp(store);
  return new Promise<{ server: Server; port: number; close: () => void }>((resolvePromise) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('无法确定监听端口');
      resolvePromise({
        server,
        port: address.port,
        close: () => {
          server.close();
          store.close();
        }
      });
    });
  });
}
