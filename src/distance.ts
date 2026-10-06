import {
  InversionExample,
  Witness,
  WitnessStep,
  AppError,
  LIMITS,
} from "./types.js";

export interface MergeResult {
  inversions: bigint;
  evidence: InversionExample[];
  evidenceTruncated: boolean;
}

/**
 * 归并排序计数逆序对。ranks[i] = fromItems[i] 在 toItems 中的目标下标（0 基）。
 * 计数使用 BigInt；evidence 只在预算内收集真实逆序对，不影响总计数。
 */
export function countInversions(
  fromItems: string[],
  ranks: number[],
  budget: number
): MergeResult {
  const n = ranks.length;
  const src = Array.from({ length: n }, (_, i) => i);
  const aux = new Array<number>(n);
  let inversions = 0n;
  const evidence: InversionExample[] = [];

  const addEvidence = (leftIdx: number, rightIdx: number) => {
    if (evidence.length >= budget) return;
    evidence.push({
      idA: fromItems[leftIdx]!,
      idB: fromItems[rightIdx]!,
      fromPositionA: leftIdx + 1,
      fromPositionB: rightIdx + 1,
      toPositionA: ranks[leftIdx]! + 1,
      toPositionB: ranks[rightIdx]! + 1,
    });
  };

  const merge = (lo: number, mid: number, hi: number) => {
    for (let k = lo; k <= hi; k++) aux[k] = src[k]!;
    let i = lo;
    let j = mid + 1;
    for (let k = lo; k <= hi; k++) {
      if (i > mid) {
        src[k] = aux[j++]!;
      } else if (j > hi) {
        src[k] = aux[i++]!;
      } else if (ranks[aux[i]!]! <= ranks[aux[j]!]!) {
        src[k] = aux[i++]!;
      } else {
        const rightIdx = aux[j]!;
        inversions += BigInt(mid - i + 1);
        if (budget > 0 && evidence.length < budget)
          for (let p = i; p <= mid && evidence.length < budget; p++) addEvidence(aux[p]!, rightIdx);
        src[k] = aux[j++]!;
      }
    }
  };

  let width = 1;
  while (width < n) {
    for (let lo = 0; lo < n; lo += width * 2) {
      const mid = Math.min(lo + width, n) - 1;
      const hi = Math.min(lo + width * 2, n) - 1;
      if (mid < hi) merge(lo, mid, hi);
    }
    width *= 2;
  }

  return { inversions, evidence, evidenceTruncated: BigInt(evidence.length) < inversions };
}

export function buildRanks(fromItems: string[], toItems: string[]): number[] {
  const targetIndex = new Map<string, number>();
  toItems.forEach((id, i) => targetIndex.set(id, i));
  return fromItems.map((id) => {
    const p = targetIndex.get(id);
    if (p === undefined) throw new AppError("SET_MISMATCH", `编号 ${id} 不在目标列表中`);
    return p;
  });
}

/**
 * 确定的最短相邻交换见证：按目标顺序从左到右，
 * 把所需元素通过相邻交换冒泡到当前位置。交换次数恰为逆序距离。
 * 仅对 n <= 50 生成。
 */
export function generateWitness(toItems: string[], ranks: number[]): Witness {
  const n = toItems.length;
  if (n > LIMITS.witnessThreshold) {
    return {
      generated: false,
      omitted: true,
      reason: `元素数 ${n} 超过见证阈值 ${LIMITS.witnessThreshold}，大输入只报告距离，不展开见证`,
      steps: [],
    };
  }

  const current = ranks.slice();
  const idAt = current.slice().map((rank) => toItems[rank]!);
  const steps: WitnessStep[] = [];
  let stepNo = 0;

  for (let pos = 0; pos < n; pos++) {
    let cur = pos;
    while (current[cur] !== pos) cur++;
    while (cur > pos) {
      const a = cur - 1;
      const b = cur;
      const tmpRank = current[a]!;
      current[a] = current[b]!;
      current[b] = tmpRank;
      const tmpId = idAt[a]!;
      idAt[a] = idAt[b]!;
      idAt[b] = tmpId;
      steps.push({
        step: ++stepNo,
        index: a,
        idLeft: idAt[a]!,
        idRight: idAt[b]!,
        fixedPrefix: idAt.slice(0, a),
      });
      cur--;
    }
  }

  return { generated: true, omitted: false, steps };
}

export interface VerifyResult {
  ok: boolean;
  error?: { code: string; step?: number; message: string };
  swaps: number;
  finalOrder: string[];
}

/** 逐步重放见证：拒绝越界或非相邻交换；结束后必须完全等于目标。 */
export function verifyWitness(
  fromItems: string[],
  toItems: string[],
  steps: WitnessStep[]
): VerifyResult {
  const order = fromItems.slice();
  if (!Array.isArray(steps)) {
    return { ok: false, error: { code: "INVALID_WITNESS", message: "steps 必须是数组" }, swaps: 0, finalOrder: order };
  }
  for (const raw of steps) {
    const s = raw as WitnessStep;
    if (typeof s?.index !== "number" || !Number.isInteger(s.index)) {
      return { ok: false, error: { code: "INVALID_WITNESS", step: s?.step, message: "交换下标必须是整数" }, swaps: 0, finalOrder: order };
    }
    const i = s.index;
    if (i < 0 || i + 1 >= order.length) {
      return { ok: false, error: { code: "INVALID_WITNESS", step: s.step, message: `第 ${s.step} 步下标 ${i} 越界（列表长度 ${order.length}）` }, swaps: 0, finalOrder: order };
    }
    if (s.idLeft !== order[i + 1] || s.idRight !== order[i]) {
      return { ok: false, error: { code: "INVALID_WITNESS", step: s.step, message: `第 ${s.step} 步涉及编号与当前排列不符：交换前位置 ${i} 为 ${order[i]}，位置 ${i + 1} 为 ${order[i + 1]}` }, swaps: 0, finalOrder: order };
    }
    const tmp = order[i]!;
    order[i] = order[i + 1]!;
    order[i + 1] = tmp;
  }
  const matches = order.length === toItems.length && order.every((id, i) => id === toItems[i]);
  if (!matches) {
    return { ok: false, error: { code: "INVALID_WITNESS", message: "见证重放结束后的排列不等于目标排列" }, swaps: steps.length, finalOrder: order };
  }
  return { ok: true, swaps: steps.length, finalOrder: order };
}

/** 归一化距离 inv / C(n,2)，保留 10 位小数（仅展示用）；n<2 按约定返回 "0"。 */
export function normalizedDistance(inversions: bigint, n: number): string {
  if (n < 2) return "0";
  const denom = BigInt(n) * BigInt(n - 1) / 2n;
  const scale = 10n ** 10n;
  const q = (inversions * scale) / denom;
  const intPart = q / scale;
  const frac = (q % scale).toString().padStart(10, "0").replace(/0+$/, "");
  return frac ? `${intPart}.${frac}` : `${intPart}`;
}

/** 小样本独立枚举所有元素对（O(n²)），仅供测试交叉核对。 */
export function bruteForceInversions(ranks: number[]): bigint {
  let count = 0n;
  for (let i = 0; i < ranks.length; i++) {
    for (let j = i + 1; j < ranks.length; j++) {
      if (ranks[i]! > ranks[j]!) count++;
    }
  }
  return count;
}
