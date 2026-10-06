import test from "node:test";
import assert from "node:assert/strict";
import {
  bruteForceInversions,
  buildRanks,
  countInversions,
  generateWitness,
  normalizedDistance,
  verifyWitness,
} from "../distance.js";

function permutations(items: string[]): string[][] {
  if (items.length <= 1) return [items.slice()];
  const out: string[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = items.slice(0, i).concat(items.slice(i + 1));
    for (const p of permutations(rest)) out.push([items[i]!, ...p]);
  }
  return out;
}

test("演示 [A,B,C] -> [B,C,A] 距离为 2，且见证是先 A-B 再 A-C", () => {
  const from = ["A", "B", "C"];
  const to = ["B", "C", "A"];
  const ranks = buildRanks(from, to);
  const { inversions } = countInversions(from, ranks, 100);
  assert.equal(inversions, 2n);
  assert.equal(bruteForceInversions(ranks), 2n);
  const w = generateWitness(to, ranks);
  assert.equal(w.steps.length, 2);
  // idLeft/idRight 表示该次相邻交换后左侧/右侧的编号：
  // 第 1 步 A 与 B 交换 -> [B,A,C]；第 2 步 A 与 C 交换 -> [B,C,A]
  assert.deepEqual([w.steps[0]!.idLeft, w.steps[0]!.idRight], ["B", "A"]);
  assert.deepEqual([w.steps[1]!.idLeft, w.steps[1]!.idRight], ["C", "A"]);
  assert.equal(verifyWitness(from, to, w.steps).ok, true);
});

test("完全相同距离为 0；空列表与单元素距离为 0", () => {
  for (const [from, to] of [
    [[], []],
    [["X"], ["X"]],
    [["A", "B", "C"], ["A", "B", "C"]],
  ] as Array<[string[], string[]]>) {
    const ranks = buildRanks(from, to);
    assert.equal(countInversions(from, ranks, 10).inversions, 0n);
    assert.equal(normalizedDistance(0n, from.length), "0");
  }
});

test("只交换一对相邻元素距离为 1", () => {
  const from = ["1", "2", "3", "4", "5"];
  const to = ["1", "3", "2", "4", "5"];
  const ranks = buildRanks(from, to);
  assert.equal(countInversions(from, ranks, 10).inversions, 1n);
  const w = generateWitness(to, ranks);
  assert.equal(w.steps.length, 1);
  assert.equal(verifyWitness(from, to, w.steps).ok, true);
});

test("反序列表距离为 C(n,2)，n 从 0 到 9", () => {
  for (let n = 0; n <= 9; n++) {
    const from = Array.from({ length: n }, (_, i) => `e${i}`);
    const to = from.slice().reverse();
    const ranks = buildRanks(from, to);
    const expected = BigInt((n * (n - 1)) / 2);
    assert.equal(countInversions(from, ranks, 0).inversions, expected);
    assert.equal(bruteForceInversions(ranks), expected);
    assert.equal(normalizedDistance(expected, n), n < 2 ? "0" : "1");
  }
});

test("固定种子小排列：枚举所有元素对独立核对 + 见证重放合法且抵达目标", () => {
  let seed = 20261005;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const items = ["p", "q", "r", "s", "t", "u", "v"];
  const all = permutations(items);
  const identity = items.slice();
  for (let trial = 0; trial < 60; trial++) {
    const target = all[Math.floor(rand() * all.length)]!;
    const ranks = buildRanks(identity, target);
    const merge = countInversions(identity, ranks, 999);
    assert.equal(merge.inversions, bruteForceInversions(ranks));
    const w = generateWitness(target, ranks);
    assert.equal(BigInt(w.steps.length), merge.inversions);
    const v = verifyWitness(identity, target, w.steps);
    assert.equal(v.ok, true, v.error?.message);
    assert.deepEqual(v.finalOrder, target);
  }
});

test("距离对称：d(a,b) === d(b,a)", () => {
  const a = ["甲", "乙", "丙", "丁", "戊"];
  const b = ["丁", "甲", "戊", "乙", "丙"];
  const dab = countInversions(a, buildRanks(a, b), 0).inversions;
  const dba = countInversions(b, buildRanks(b, a), 0).inversions;
  assert.equal(dab, dba);
});

test("整体重命名但保留对应关系不改变结果", () => {
  const from = ["A", "B", "C", "D"];
  const to = ["C", "A", "D", "B"];
  const rename = new Map([
    ["A", "甲"],
    ["B", "乙"],
    ["C", "丙"],
    ["D", "丁"],
  ]);
  const r1 = countInversions(from, buildRanks(from, to), 5).inversions;
  const r2 = countInversions(
    from.map((x) => rename.get(x)!),
    buildRanks(
      from.map((x) => rename.get(x)!),
      to.map((x) => rename.get(x)!)
    ),
    5
  ).inversions;
  assert.equal(r1, r2);
});

test("中文编号正常计算", () => {
  const from = ["甲", "乙", "丙"];
  const to = ["丙", "甲", "乙"];
  assert.equal(countInversions(from, buildRanks(from, to), 5).inversions, 2n);
});

test("证据预算不改变总计数，只截断展示", () => {
  const from = ["1", "2", "3", "4", "5", "6"];
  const to = ["6", "5", "4", "3", "2", "1"];
  const ranks = buildRanks(from, to);
  const r = countInversions(from, ranks, 3);
  assert.equal(r.inversions, 15n);
  assert.equal(r.evidence.length, 3);
  assert.equal(r.evidenceTruncated, true);
  for (const e of r.evidence) {
    assert.ok(e.fromPositionA < e.fromPositionB);
    assert.ok(e.toPositionA > e.toPositionB);
  }
});

test("大整数：n=100000 反序，距离为十进制大整数，见证被省略", () => {
  const n = 100_000;
  const from = Array.from({ length: n }, (_, i) => `e${i}`);
  const to = from.slice().reverse();
  const ranks = buildRanks(from, to);
  const r = countInversions(from, ranks, 0);
  const expected = (BigInt(n) * BigInt(n - 1)) / 2n;
  assert.equal(r.inversions, expected);
  const w = generateWitness(to, ranks);
  assert.equal(w.generated, false);
  assert.equal(w.omitted, true);
});

test("核验拒绝越界交换、非相邻交换与错误编号", () => {
  const from = ["A", "B", "C"];
  const to = ["B", "C", "A"];
  assert.equal(verifyWitness(from, to, [{ step: 1, index: 2, idLeft: "A", idRight: "C", fixedPrefix: [] }]).ok, false);
  assert.equal(
    verifyWitness(from, to, [
      { step: 1, index: 0, idLeft: "X", idRight: "Y", fixedPrefix: [] },
    ]).ok,
    false
  );
  assert.equal(
    verifyWitness(["A", "B", "C"], ["A", "C", "B"], [
      { step: 1, index: 0, idLeft: "B", idRight: "A", fixedPrefix: [] },
    ]).ok,
    false
  );
});

test("n=50 恰好可生成见证，n=51 不展开", () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => `e${i}`);
  const f50 = mk(50);
  const t50 = f50.slice().reverse();
  const w50 = generateWitness(t50, buildRanks(f50, t50));
  assert.equal(w50.generated, true);
  assert.equal(verifyWitness(f50, t50, w50.steps).ok, true);
  const f51 = mk(51);
  const w51 = generateWitness(f51.slice().reverse(), buildRanks(f51, f51.slice().reverse()));
  assert.equal(w51.generated, false);
});
