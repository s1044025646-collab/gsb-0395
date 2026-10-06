import { AppError, fail, issue } from './errors.js';
import {
  ALGORITHM_VERSION,
  LIMITS,
  type DistanceResult,
  type InversionExample,
  type KendallInput,
  type SwapStep,
  type ValidationIssue
} from './types.js';

function isStringArray(value: unknown, field: string, issues: ValidationIssue[]) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    issues.push(issue('INVALID_ARGUMENT', `${field} 必须是字符串编号数组`, field));
    return false;
  }
  return true;
}

function findDuplicates(items: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of items) {
    if (seen.has(item)) duplicates.add(item);
    seen.add(item);
  }
  return [...duplicates];
}

export function validateInput(
  candidate: Partial<KendallInput>,
  options: { exampleBudget?: number } = {}
): KendallInput {
  const issues: ValidationIssue[] = [];
  const sourceValid = isStringArray(candidate.source, 'source', issues);
  const targetValid = isStringArray(candidate.target, 'target', issues);
  if (!sourceValid || !targetValid) throw new AppError('INVALID_ARGUMENT', '参数格式不正确', { issues });

  const source = candidate.source as string[];
  const target = candidate.target as string[];

  if (source.some((id) => id.length === 0) || target.some((id) => id.length === 0)) {
    issues.push(issue('INVALID_ARGUMENT', '编号不能为空字符串'));
  }
  if (source.some((id) => id.length > LIMITS.maxIdLength) || target.some((id) => id.length > LIMITS.maxIdLength)) {
    issues.push(issue('ID_TOO_LONG', `编号长度不能超过 ${LIMITS.maxIdLength} 个字符`));
  }
  if (source.length > LIMITS.maxElements || target.length > LIMITS.maxElements) {
    issues.push(issue('TOO_LARGE', `列表元素个数不能超过 ${LIMITS.maxElements}`));
  }

  const sourceDuplicates = findDuplicates(source);
  const targetDuplicates = findDuplicates(target);
  if (sourceDuplicates.length > 0 || targetDuplicates.length > 0) {
    issues.push(issue('DUPLICATE_ID', '两份列表均必须由唯一编号组成', undefined, { sourceDuplicates, targetDuplicates }));
  }

  if (issues.length === 0 && source.length !== target.length) {
    issues.push(issue('SET_MISMATCH', '两份列表必须包含同一组编号：长度不同', undefined, {
      sourceLength: source.length,
      targetLength: target.length
    }));
  }
  if (issues.length === 0) {
    const sourceSet = new Set(source);
    const missing = target.filter((id) => !sourceSet.has(id));
    const targetSet = new Set(target);
    const extra = source.filter((id) => !targetSet.has(id));
    if (missing.length > 0 || extra.length > 0) {
      issues.push(issue('SET_MISMATCH', '两份列表必须包含同一组编号：存在缺项或额外项', undefined, { missing, extra }));
    }
  }

  const budget = options.exampleBudget ?? LIMITS.defaultExamples;
  if (!Number.isInteger(budget) || budget < 0 || budget > LIMITS.maxExamples) {
    issues.push(issue('INVALID_ARGUMENT', `解释预算必须是 0 到 ${LIMITS.maxExamples} 的整数`, 'exampleBudget'));
  }

  if (issues.length > 0) throw new AppError('INVALID_ARGUMENT', '输入校验失败', { issues });
  return { source, target };
}

export function countInversionsMerge(values: bigint[]): bigint {
  const working = values.slice();
  const auxiliary = new Array<bigint>(values.length);

  function sortAndCount(left: number, right: number): bigint {
    if (right - left <= 1) return 0n;
    const middle = Math.floor((left + right) / 2);
    let inversions = sortAndCount(left, middle) + sortAndCount(middle, right);
    let readLeft = left;
    let readRight = middle;
    let write = left;

    while (readLeft < middle && readRight < right) {
      if (working[readLeft]! <= working[readRight]!) {
        auxiliary[write++] = working[readLeft++]!;
      } else {
        inversions += BigInt(middle - readLeft);
        auxiliary[write++] = working[readRight++]!;
      }
    }
    while (readLeft < middle) auxiliary[write++] = working[readLeft++]!;
    while (readRight < right) auxiliary[write++] = working[readRight++]!;
    for (let index = left; index < right; index += 1) working[index] = auxiliary[index]!;
    return inversions;
  }

  return sortAndCount(0, values.length);
}

export function countInversionsEnumeration(values: readonly bigint[]): bigint {
  let inversions = 0n;
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      if (values[i]! > values[j]!) inversions += 1n;
    }
  }
  return inversions;
}

export function enumerateInversions(
  source: string[],
  targetPositions: Map<string, number>,
  limit: number
): InversionExample[] {
  const examples: InversionExample[] = [];
  for (let i = 0; i < source.length && examples.length < limit; i += 1) {
    for (let j = i + 1; j < source.length && examples.length < limit; j += 1) {
      const idA = source[i]!;
      const idB = source[j]!;
      const targetA = targetPositions.get(idA)!;
      const targetB = targetPositions.get(idB)!;
      if (targetA > targetB) {
        examples.push({
          idA,
          idB,
          sourcePositionA: i + 1,
          sourcePositionB: j + 1,
          targetPositionA: targetA + 1,
          targetPositionB: targetB + 1
        });
      }
    }
  }
  return examples;
}

export function generateWitness(source: readonly string[], target: readonly string[]): SwapStep[] {
  if (source.length > LIMITS.witnessMaxElements) {
    fail('WITNESS_TOO_LARGE', `超过 ${LIMITS.witnessMaxElements} 个元素时不展开见证，避免海量交换阻塞服务`);
  }

  const current = source.slice();
  const steps: SwapStep[] = [];
  for (let fixedPosition = 0; fixedPosition < target.length; fixedPosition += 1) {
    const wantedId = target[fixedPosition]!;
    const currentPosition = current.indexOf(wantedId);
    if (currentPosition < fixedPosition) fail('INVALID_WITNESS', '见证生成器内部状态错误');

    for (let position = currentPosition; position > fixedPosition; position -= 1) {
      const leftPosition = position - 1;
      const rightPosition = position;
      const leftId = current[leftPosition]!;
      const rightId = current[rightPosition]!;
      current[leftPosition] = rightId;
      current[rightPosition] = leftId;
      steps.push({
        step: steps.length + 1,
        leftPosition: leftPosition + 1,
        rightPosition: rightPosition + 1,
        leftId,
        rightId,
        fixedPrefix: current.slice(0, fixedPosition)
      });
    }
  }
  return steps;
}

export function replayWitness(source: readonly string[], target: readonly string[], steps: readonly SwapStep[]): string[] {
  const current = source.slice();
  for (const candidate of steps) {
    const left = candidate.leftPosition - 1;
    const right = candidate.rightPosition - 1;
    const validStep =
      Number.isInteger(left) &&
      Number.isInteger(right) &&
      right === left + 1 &&
      left >= 0 &&
      right < current.length &&
      current[left] === candidate.leftId &&
      current[right] === candidate.rightId;
    if (!validStep) {
      fail('INVALID_WITNESS', `第 ${candidate.step} 步不是有效的相邻交换，或涉及编号与当前排列不一致`, candidate);
    }
    current[left] = candidate.rightId;
    current[right] = candidate.leftId;
  }
  if (current.length !== target.length || current.some((id, index) => id !== target[index])) {
    fail('INVALID_WITNESS', '见证重放结束后的排列不等于目标排列', { final: current, target });
  }
  return current;
}

export function analyze(input: Partial<KendallInput>, exampleBudget = LIMITS.defaultExamples): DistanceResult {
  const { source, target } = validateInput(input, { exampleBudget });
  const targetPositions = new Map<string, number>();
  target.forEach((id, index) => targetPositions.set(id, index));
  const mappedPositions = source.map((id) => targetPositions.get(id)!);
  const mappedBigInts = mappedPositions.map(BigInt);
  const inversions = countInversionsMerge(mappedBigInts);
  const n = BigInt(source.length);
  const totalPairs = n < 2n ? 0n : (n * (n - 1n)) / 2n;
  const normalizedDistance = totalPairs === 0n ? 0 : Number(inversions * 10_000_000_000_000n / totalPairs) / 10_000_000_000_000;
  const examples = enumerateInversions(source, targetPositions, exampleBudget);
  const includeWitness = source.length <= LIMITS.witnessMaxElements;
  const steps = includeWitness ? generateWitness(source, target) : [];

  if (includeWitness && BigInt(steps.length) !== inversions) {
    fail('INVALID_WITNESS', '见证步数不等于逆序距离');
  }

  return {
    n: source.length,
    source,
    target,
    mappedPositions,
    targetPositions: Object.fromEntries(mappedPositions.map((position, index) => [source[index]!, position + 1])),
    totalPairs: totalPairs.toString(),
    inversions: inversions.toString(),
    normalizedDistance: normalizedDistance.toFixed(12).replace(/\.?0+$/, ''),
    examples,
    witness: includeWitness
      ? { generated: true, steps }
      : {
          generated: false,
          reason: `元素数超过 ${LIMITS.witnessMaxElements}；仅报告完整距离，不展开可能海量的交换见证`,
          steps: []
        },
    algorithmVersion: ALGORITHM_VERSION
  };
}

export function renameIds(result: DistanceResult, mapping: Record<string, string>): KendallInput {
  return {
    source: result.source.map((id) => mapping[id] ?? fail('INVALID_ARGUMENT', `重命名映射缺少 ${id}`)),
    target: result.target.map((id) => mapping[id] ?? fail('INVALID_ARGUMENT', `重命名映射缺少 ${id}`))
  };
}
