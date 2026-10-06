import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before } from "node:test";
import { openDatabase } from "../db.js";
import { KendallService } from "../service.js";
import { AppError } from "../types.js";
import { verifyWitness } from "../distance.js";
import { startServer, type RunningServer } from "../server.js";

const dir = mkdtempSync(join(tmpdir(), "kendall-"));
const service = new KendallService(openDatabase(dir));

test("重复编号报 DUPLICATE_ID；缺项/额外项报 SET_MISMATCH", () => {
  assert.throws(
    () => service.compute({ name: "a", items: ["A", "A", "B"] }, { name: "b", items: ["A", "B", "C"] }, {}),
    (e: unknown) => e instanceof AppError && e.code === "DUPLICATE_ID"
  );
  const err = (() => {
    try {
      service.compute({ name: "a", items: ["A", "B"] }, { name: "b", items: ["A", "C"] }, {});
    } catch (e) {
      return e as AppError;
    }
    return undefined;
  })();
  assert.ok(err instanceof AppError && err.code === "SET_MISMATCH");
  assert.deepEqual((err.details as { missingInFrom: string[] }).missingInFrom, ["C"]);
  assert.deepEqual((err.details as { extraInFrom: string[] }).extraInFrom, ["B"]);
});

test("长度不同（缺项）被拒绝", () => {
  assert.throws(
    () => service.compute({ name: "a", items: ["A"] }, { name: "b", items: ["A", "B"] }, {}),
    (e: unknown) => e instanceof AppError && e.code === "SET_MISMATCH"
  );
});

test("报告持久化：大整数与见证可重新读取", () => {
  const r = service.compute(
    { name: "原", items: ["A", "B", "C", "D"] },
    { name: "目标", items: ["D", "C", "B", "A"] },
    { evidenceBudget: 2 }
  );
  assert.equal(r.inversions, "6");
  assert.equal(r.totalPairs, "6");
  const again = service.getReport(r.reportId);
  assert.equal(again.inversions, "6");
  assert.equal(again.witness.steps.length, 6);
  assert.equal(again.evidence.length, 2);
  assert.equal(again.evidenceTruncated, true);
  assert.deepEqual(
    again.mapping.map((m) => m.toPosition),
    [4, 3, 2, 1]
  );
});

test("重启后（全新 service 实例同一 DB）仍可读取完整大整数与见证", () => {
  const svc2 = new KendallService(openDatabase(dir));
  const list = svc2.listReports();
  assert.ok(list.length >= 1);
  const id = list[0]!.reportId;
  const r = svc2.getReport(id);
  assert.ok(/^\d+$/.test(r.inversions));
  assert.equal(
    verifyWitness(r.fromItems, r.toItems, r.witness.steps).ok || r.witness.omitted,
    true
  );
});

test("大输入报告省略见证但距离正确", () => {
  const n = 1000;
  const items = Array.from({ length: n }, (_, i) => `x${i}`);
  const r = service.compute({ name: "big", items }, { name: "rev", items: items.slice().reverse() }, {});
  assert.equal(r.inversions, String((n * (n - 1)) / 2));
  assert.equal(r.witness.omitted, true);
  assert.equal(r.witness.steps.length, 0);
});

test("版本比较：交换一对相邻元素只改变距离 1", () => {
  const base = service.compute(
    { name: "a", items: ["1", "2", "3", "4"] },
    { name: "b", items: ["1", "2", "3", "4"] },
    {}
  );
  const swapped = service.compute(
    { name: "a", items: ["1", "2", "3", "4"] },
    { name: "b2", items: ["1", "3", "2", "4"] },
    {}
  );
  const cmp = service.compare(swapped.reportId, base.reportId);
  assert.equal(cmp.inversionDelta, "1");
  assert.equal(cmp.sameInputs, false);
});

let server: RunningServer;
before(async () => {
  server = await startServer(0);
});
after(() => server.close());

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`http://localhost:${server.port}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

test("HTTP: 健康检查、计算、映射、证据、见证、导出、核验、比较全链路", async () => {
  const h = await api("GET", "/health");
  assert.equal(h.status, 200);

  const created = await api("POST", "/reports", {
    from: { name: "f", items: ["A", "B", "C"] },
    to: { name: "t", items: ["B", "C", "A"] },
    evidenceBudget: 5,
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.inversions, "2");
  const id = created.json.reportId as string;

  const mapping = await api("GET", `/reports/${id}/mapping`);
  assert.deepEqual(
    mapping.json.mapping.map((m: { toPosition: number }) => m.toPosition),
    [3, 1, 2]
  );

  const witness = await api("GET", `/reports/${id}/witness`);
  assert.equal(witness.json.witness.steps.length, 2);

  const verify = await api("POST", "/witness/verify", {
    from: { items: ["A", "B", "C"] },
    to: { items: ["B", "C", "A"] },
    steps: witness.json.witness.steps,
  });
  assert.equal(verify.json.ok, true);

  const badVerify = await api("POST", "/witness/verify", {
    from: { items: ["A", "B", "C"] },
    to: { items: ["B", "C", "A"] },
    steps: [{ step: 1, index: 5, idLeft: "A", idRight: "B", fixedPrefix: [] }],
  });
  assert.equal(badVerify.json.ok, false);

  const exp = await api("GET", `/reports/${id}/export`);
  assert.equal(exp.status, 200);
  assert.equal(exp.json.inversions, "2");

  const second = await api("POST", "/reports", {
    from: { items: ["A", "B", "C"] },
    to: { items: ["A", "B", "C"] },
  });
  const cmp = await api("POST", "/reports/compare", { reportIdA: id, reportIdB: second.json.reportId });
  assert.equal(cmp.status, 200);
  assert.equal(cmp.json.inversionDelta, "2");
});

test("HTTP: 校验失败返回结构化错误码且不产生报告", async () => {
  const beforeCount = (await api("GET", "/reports")).json.reports.length;
  const bad = await api("POST", "/reports", {
    from: { items: ["A", "B"] },
    to: { items: ["B", "B"] },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, "DUPLICATE_ID");
  const afterCount = (await api("GET", "/reports")).json.reports.length;
  assert.equal(afterCount, beforeCount);

  const nf = await api("GET", "/reports/does-not-exist");
  assert.equal(nf.status, 404);
  assert.equal(nf.json.error.code, "NOT_FOUND");
});
