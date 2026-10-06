import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openDatabase } from "./db.js";
import { KendallService } from "./service.js";
import { AppError } from "./types.js";
import { validateItems, validatePair } from "./validate.js";
import { verifyWitness } from "./distance.js";
import { startServer } from "./server.js";

function parseItems(spec: string): { name: string; items: string[] } {
  if (spec.includes("=")) {
    const eq = spec.indexOf("=");
    return { name: spec.slice(0, eq), items: parseList(spec.slice(eq + 1)) };
  }
  return { name: "list", items: parseList(spec) };
}

function parseList(text: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  }
  return validateItems(parsed, "items");
}

function parseFlags(args: string[]): { positional: string[]; flags: Map<string, string> } {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, "true");
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function print(obj: unknown): void {
  console.log(JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseFlags(rest);

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(USAGE);
    return;
  }

  if (cmd === "serve") {
    const port = flags.get("port") ?? process.env.PORT ?? "0";
    const p = Number(port);
    if (!Number.isInteger(p) || p < 0) throw new AppError("BAD_REQUEST", "--port 必须是非负整数（0 表示选择空闲端口）");
    const running = await startServer(p);
    console.log(`服务已启动: http://localhost:${running.port}`);
    return;
  }

  const db = openDatabase(flags.get("data-dir") ?? process.env.DATA_DIR ?? "data");
  const service = new KendallService(db);

  try {
    switch (cmd) {
      case "snapshot": {
        if (!positional[0]) throw new AppError("BAD_REQUEST", "用法: snapshot <name=[...] 或 JSON 数组>");
        print(service.createSnapshot(parseItems(positional[0])));
        break;
      }
      case "snapshot-get": {
        if (!positional[0]) throw new AppError("BAD_REQUEST", "用法: snapshot-get <id>");
        print(service.getSnapshot(positional[0]));
        break;
      }
      case "distance": {
        if (positional.length < 2) throw new AppError("BAD_REQUEST", "用法: distance <from> <to> [--evidence N]");
        const fromSpec = positional[0]!;
        const toSpec = positional[1]!;
        const from = parseItems(fromSpec);
        const to = parseItems(toSpec);
        print(service.compute(from, to, { evidenceBudget: flags.get("evidence") ?? 20 }));
        break;
      }
      case "get": {
        if (!positional[0]) throw new AppError("BAD_REQUEST", "用法: get <reportId>");
        print(service.getReport(positional[0]));
        break;
      }
      case "mapping":
      case "evidence":
      case "witness": {
        if (!positional[0]) throw new AppError("BAD_REQUEST", `用法: ${cmd} <reportId>`);
        const report = service.getReport(positional[0]);
        if (cmd === "mapping") print({ reportId: report.reportId, mapping: report.mapping });
        if (cmd === "evidence")
          print({
            reportId: report.reportId,
            inversions: report.inversions,
            totalPairs: report.totalPairs,
            evidence: report.evidence,
            evidenceTruncated: report.evidenceTruncated,
          });
        if (cmd === "witness") print({ reportId: report.reportId, witness: report.witness });
        break;
      }
      case "list": {
        print({ reports: service.listReports() });
        break;
      }
      case "compare": {
        if (positional.length < 2) throw new AppError("BAD_REQUEST", "用法: compare <reportIdA> <reportIdB>");
        print(service.compare(positional[0]!, positional[1]!));
        break;
      }
      case "verify": {
        if (positional.length < 3) throw new AppError("BAD_REQUEST", "用法: verify <from> <to> <witness.json 路径>");
        const fromItems = parseList(positional[0]!);
        const toItems = parseList(positional[1]!);
        validatePair(fromItems, toItems);
        const steps = JSON.parse(readText(positional[2]!));
        print(verifyWitness(fromItems, toItems, steps));
        break;
      }
      case "export": {
        if (!positional[0]) throw new AppError("BAD_REQUEST", "用法: export <reportId> [--out file.json]");
        const report = service.getReport(positional[0]);
        const json = JSON.stringify(report, null, 2);
        const out = flags.get("out");
        if (out) {
          writeFileSync(resolve(out), json, "utf8");
          console.log(`已导出到 ${resolve(out)}`);
        } else {
          console.log(json);
        }
        break;
      }
      case "demo": {
        runDemo(service);
        break;
      }
      default:
        throw new AppError("BAD_REQUEST", `未知命令: ${cmd}\n\n${USAGE}`);
    }
  } finally {
    db.close();
  }
}

function readText(p: string): string {
  return readFileSync(resolve(p), "utf8");
}

function runDemo(service: KendallService): void {
  console.log("=== 演示 1: [A,B,C] -> [B,C,A]，Kendall 逆序距离应为 2 ===");
  const r1 = service.compute(
    { name: "原始", items: ["A", "B", "C"] },
    { name: "目标", items: ["B", "C", "A"] },
    { evidenceBudget: 10 }
  );
  console.log(`n=${r1.n} 总元素对数=${r1.totalPairs} 逆序数=${r1.inversions} 归一化=${r1.normalized}`);
  console.log("真实逆序对例子:");
  for (const e of r1.evidence) {
    console.log(
      `  (${e.idA}, ${e.idB}) 原始位置 ${e.fromPositionA}>${e.fromPositionB}? 否；目标位置 ${e.toPositionA}>${e.toPositionB}`
    );
  }
  console.log("最短相邻交换见证:");
  for (const s of r1.witness.steps) {
    console.log(`  第${s.step}步 交换下标 ${s.index} 与 ${s.index + 1}: ${s.idRight} <-> ${s.idLeft}`);
  }

  console.log("\n=== 演示 2: 反序 [1..5] -> [5..1]，距离应为 C(5,2)=10 ===");
  const r2 = service.compute(
    { name: "顺序", items: ["1", "2", "3", "4", "5"] },
    { name: "反序", items: ["5", "4", "3", "2", "1"] },
    {}
  );
  console.log(`逆序数=${r2.inversions} 归一化=${r2.normalized} 见证步数=${r2.witness.steps.length}`);

  console.log("\n=== 演示 3: 中文编号 ===");
  const r3 = service.compute(
    { name: "上午", items: ["甲", "乙", "丙"] },
    { name: "下午", items: ["丙", "甲", "乙"] },
    {}
  );
  console.log(`逆序数=${r3.inversions} 归一化=${r3.normalized}`);

  console.log("\n=== 演示 4: 重复编号被拒绝（不写入任何分析）===");
  try {
    service.compute({ name: "x", items: ["A", "A"] }, { name: "y", items: ["A", "B"] }, {});
  } catch (e) {
    if (e instanceof AppError) console.log(`已拒绝 [${e.code}] ${e.message}`);
  }

  console.log("\n=== 演示 5: 大输入（n=100000）只报告距离，不展开见证 ===");
  const big = Array.from({ length: 100_000 }, (_, i) => `e${i}`);
  const bigRev = big.slice().reverse();
  const r5 = service.compute({ name: "big", items: big }, { name: "bigRev", items: bigRev }, {});
 console.log(`n=${r5.n} 逆序数=${r5.inversions}（十进制大整数）见证省略=${r5.witness.omitted}（${r5.witness.reason}）`);
}

const USAGE = `Kendall 逆序距离后端 CLI

用法:
  node dist/cli.js serve [--port 0] [--data-dir data]   启动 HTTP API（默认 0=选择空闲端口）
  node dist/cli.js snapshot '<名称=[...]/JSON/逗号分隔>' 创建顺序快照
  node dist/cli.js snapshot-get <id>                    查看快照
  node dist/cli.js distance <from> <to> [--evidence N]  计算距离并生成/省略见证
  node dist/cli.js get <reportId>                       查看完整报告
  node dist/cli.js mapping <reportId>                   查看目标位置映射
  node dist/cli.js evidence <reportId>                  查看逆序对证据
  node dist/cli.js witness <reportId>                   查看相邻交换见证
  node dist/cli.js list                                 列出报告
  node dist/cli.js compare <idA> <idB>                  比较两个报告版本
  node dist/cli.js verify <from> <to> <witness.json>    独立重放核验见证
  node dist/cli.js export <reportId> [--out file.json]  导出报告 JSON
  node dist/cli.js demo                                 运行内置演示

列表参数支持 JSON 数组（["A","B"]）或逗号分隔（A,B），可用 name= 前缀命名。
环境变量: PORT（默认端口）、DATA_DIR（默认 data）。`;

main().catch((err: unknown) => {
  if (err instanceof AppError) {
    console.error(`错误 [${err.code}]: ${err.message}`);
    if (err.details !== undefined) console.error(JSON.stringify(err.details, null, 2));
  } else {
    console.error(err);
  }
  process.exit(1);
});
