import { AppError, LIMITS } from "./types.js";

export function validateItems(items: unknown, field: string): string[] {
  if (!Array.isArray(items)) {
    throw new AppError("VALIDATION_ERROR", `${field} 必须是字符串编号数组`, { field });
  }
  if (items.length > LIMITS.maxElements) {
    throw new AppError(
      "VALIDATION_ERROR",
      `元素个数超出上限 ${LIMITS.maxElements}（收到 ${items.length}）`,
      { field, limit: LIMITS.maxElements }
    );
  }
  const result: string[] = [];
  for (const raw of items) {
    if (typeof raw !== "string") {
      throw new AppError("VALIDATION_ERROR", `${field} 中存在非字符串编号`, { field, value: String(raw) });
    }
    const id = raw;
    if (id.length === 0) {
      throw new AppError("VALIDATION_ERROR", `${field} 中存在空字符串编号`, { field });
    }
    if (id.length > LIMITS.maxIdLength) {
      throw new AppError(
        "VALIDATION_ERROR",
        `编号长度超出上限 ${LIMITS.maxIdLength}：${id.slice(0, 20)}…`,
        { field, limit: LIMITS.maxIdLength }
      );
    }
    result.push(id);
  }
  return result;
}

function findDuplicates(items: string[]): string[] {
  const seen = new Set<string>();
  const dups: string[] = [];
  for (const id of items) {
    if (seen.has(id)) {
      if (!dups.includes(id)) dups.push(id);
    } else {
      seen.add(id);
    }
  }
  return dups;
}

export function validatePair(fromItems: string[], toItems: string[]): void {
  const dupFrom = findDuplicates(fromItems);
  const dupTo = findDuplicates(toItems);
  if (dupFrom.length > 0 || dupTo.length > 0) {
    throw new AppError("DUPLICATE_ID", "列表中存在重复编号，全排列要求每个编号唯一", {
      duplicatesInFrom: dupFrom,
      duplicatesInTo: dupTo,
    });
  }
  if (fromItems.length !== toItems.length) {
    const fromSet = new Set(fromItems);
    const toSet = new Set(toItems);
    throw new AppError(
      "SET_MISMATCH",
      `两份列表长度不一致（${fromItems.length} vs ${toItems.length}），拒绝缺项与额外项`,
      {
        missingInFrom: toItems.filter((id) => !fromSet.has(id)),
        extraInFrom: fromItems.filter((id) => !toSet.has(id)),
      }
    );
  }
  const fromSet = new Set(fromItems);
  const toSet = new Set(toItems);
  const missingInFrom = toItems.filter((id) => !fromSet.has(id));
  const extraInFrom = fromItems.filter((id) => !toSet.has(id));
  if (missingInFrom.length > 0 || extraInFrom.length > 0) {
    throw new AppError("SET_MISMATCH", "两份列表编号集合不一致，拒绝缺项与额外项", {
      missingInFrom,
      extraInFrom,
    });
  }
  void fromSet;
  void toSet;
}

export function normalizeBudget(budget: unknown, fallback = 20): number {
  if (budget === undefined || budget === null) return fallback;
  const n = Number(budget);
  if (!Number.isInteger(n) || n < 0) {
    throw new AppError("VALIDATION_ERROR", "evidenceBudget 必须是非负整数");
  }
  return Math.min(n, LIMITS.maxEvidenceBudget);
}
