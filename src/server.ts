import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { openDatabase } from "./db.js";
import { KendallService } from "./service.js";
import { AppError, LIMITS } from "./types.js";
import { validateItems, validatePair } from "./validate.js";
import { verifyWitness } from "./distance.js";

export interface RunningServer {
  server: Server;
  port: number;
  close: () => void;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(json);
}

function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 5_000_000) {
        reject(new AppError("BAD_REQUEST", "请求体超过 5MB 限制"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new AppError("BAD_REQUEST", "请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

function errorBody(err: unknown) {
  if (err instanceof AppError) {
    return { status: err.code === "NOT_FOUND" ? 404 : 400, body: { error: { code: err.code, message: err.message, details: err.details ?? null } } };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { status: 500, body: { error: { code: "INTERNAL_ERROR", message } } };
}

export async function startServer(port = 0): Promise<RunningServer> {
  const db = openDatabase();
  const service = new KendallService(db);

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const method = req.method ?? "GET";
    try {
      if (method === "GET" && path === "/health") {
        return send(res, 200, { ok: true, limits: LIMITS, algoWitnessThreshold: LIMITS.witnessThreshold });
      }
      if (method === "POST" && path === "/snapshots") {
        const body = await readJson(req);
        return send(res, 201, service.createSnapshot({ name: body?.name, items: body?.items }));
      }
      if (method === "GET" && path.startsWith("/snapshots/")) {
        return send(res, 200, service.getSnapshot(path.slice("/snapshots/".length)));
      }
      if (method === "POST" && path === "/reports") {
        const body = await readJson(req);
        return send(res, 201, service.compute(body?.from ?? {}, body?.to ?? {}, { evidenceBudget: body?.evidenceBudget }));
      }
      if (method === "GET" && path === "/reports") {
        return send(res, 200, { reports: service.listReports() });
      }
      const reportMatch = path.match(/^\/reports\/([^/]+)(\/(mapping|evidence|witness|export))?$/);
      if (method === "GET" && reportMatch) {
        const report = service.getReport(decodeURIComponent(reportMatch[1]!));
        const sub = reportMatch[3];
        if (sub === "mapping") return send(res, 200, { reportId: report.reportId, mapping: report.mapping });
        if (sub === "evidence")
          return send(res, 200, {
            reportId: report.reportId,
            inversions: report.inversions,
            totalPairs: report.totalPairs,
            evidenceBudget: report.evidenceBudget,
            evidenceTruncated: report.evidenceTruncated,
            evidence: report.evidence,
          });
        if (sub === "witness") return send(res, 200, { reportId: report.reportId, witness: report.witness });
        if (sub === "export") {
          res.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "content-disposition": `attachment; filename="report-${report.reportId}.json"`,
          });
          return res.end(JSON.stringify(report, null, 2));
        }
        return send(res, 200, report);
      }
      if (method === "POST" && path === "/witness/verify") {
        const body = await readJson(req);
        const fromItems = validateItems(body?.from?.items, "from.items");
        const toItems = validateItems(body?.to?.items, "to.items");
        validatePair(fromItems, toItems);
        return send(res, 200, verifyWitness(fromItems, toItems, body?.steps ?? []));
      }
      if (method === "POST" && path === "/reports/compare") {
        const body = await readJson(req);
        if (typeof body?.reportIdA !== "string" || typeof body?.reportIdB !== "string") {
          throw new AppError("BAD_REQUEST", "需要 reportIdA 与 reportIdB 两个字符串参数");
        }
        return send(res, 200, service.compare(body.reportIdA, body.reportIdB));
      }
      return send(res, 404, { error: { code: "NOT_FOUND", message: `无此路由：${method} ${path}` } });
    } catch (err) {
      const e = errorBody(err);
      return send(res, e.status, e.body);
    }
  };

  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(port, () => resolve()));
  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : port;
  return {
    server,
    port: actualPort,
    close: () => {
      server.close();
      db.close();
    },
  };
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("/dist/server.js");
if (isMain) {
  const requested = process.env.PORT ? Number(process.env.PORT) : 0;
  if (process.env.PORT && (!Number.isInteger(requested) || requested <= 0)) {
    console.error("PORT 环境变量必须是正整数");
    process.exit(1);
  }
  startServer(requested).then(({ port }) => {
    console.log(`Kendall 距离服务已启动: http://localhost:${port}`);
    console.log(`数据目录: ${process.env.DATA_DIR ?? "data"}（SQLite 文件 kendall.db）`);
    console.log("健康检查: GET /health");
  });
}
