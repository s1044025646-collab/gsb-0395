import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { Store } from '../db.js';
import { AppError } from '../errors.js';
import { analyze, countInversionsEnumeration, generateWitness, renameIds, replayWitness } from '../kendall.js';

describe('Kendall 距离', () => {
  it('计算 ABC 到 BCA 的距离为 2', () => {
    const result = analyze({ source: ['A', 'B', 'C'], target: ['B', 'C', 'A'] }, 10);
    assert.equal(result.inversions, '2');
    assert.equal(result.totalPairs, '3');
    assert.equal(result.normalizedDistance, '0.666666666667');
    assert.deepEqual(result.witness.steps.map((step) => [step.leftId, step.rightId]), [['A', 'B'], ['A', 'C']]);
  });

  it('相同列表、空列表和单元素距离为零', () => {
    assert.equal(analyze({ source: [], target: [] }, 0).inversions, '0');
    assert.equal(analyze({ source: ['X'], target: ['X'] }, 0).inversions, '0');
    assert.equal(analyze({ source: ['X', 'Y'], target: ['X', 'Y'] }, 0).inversions, '0');
  });

  it('仅相邻交换一对元素距离为一', () => {
    const result = analyze({ source: ['A', 'B', 'C', 'D'], target: ['A', 'C', 'B', 'D'] }, 10);
    assert.equal(result.inversions, '1');
    assert.equal(result.witness.steps.length, 1);
  });

  it('反序列表距离等于 n(n-1)/2，并与枚举一致', () => {
    for (let n = 0; n <= 9; n += 1) {
      const source = Array.from({ length: n }, (_, index) => `id-${index}`);
      const result = analyze({ source, target: source.slice().reverse() }, 0);
      assert.equal(result.inversions, result.totalPairs);
      assert.equal(result.inversions, countInversionsEnumeration(result.mappedPositions.map(BigInt)).toString());
    }
  });

  it('支持中文编号', () => {
    const result = analyze({ source: ['甲', '乙', '丙'], target: ['丙', '乙', '甲'] }, 10);
    assert.equal(result.inversions, '3');
    assert.deepEqual(result.targetPositions, { 甲: 3, 乙: 2, 丙: 1 });
  });

  it('拒绝重复编号', () => {
    assert.throws(() => analyze({ source: ['A', 'A'], target: ['A', 'B'] }, 0), (error: unknown) => error instanceof AppError && error.code === 'INVALID_ARGUMENT');
  });

  it('拒绝缺项和额外项', () => {
    assert.throws(() => analyze({ source: ['A', 'B'], target: ['A', 'C'] }, 0), (error: unknown) => error instanceof AppError);
  });

  it('固定种子小排列使用独立枚举核对全部样本', () => {
    let seed = 20261005;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_647;
      return seed / 2_147_483_647;
    };
    const ids = ['0', '1', '2', '3', '4', '5', '6'];
    for (let sample = 0; sample < 100; sample += 1) {
      const target = ids.slice();
      for (let index = target.length - 1; index > 0; index -= 1) {
        const other = Math.floor(random() * (index + 1));
        [target[index], target[other]] = [target[other]!, target[index]!];
      }
      const result = analyze({ source: ids, target }, 0);
      assert.equal(result.inversions, countInversionsEnumeration(result.mappedPositions.map(BigInt)).toString());
    }
  });

  it('距离对称且整体重命名不改变结果', () => {
    const source = ['A', 'B', 'C', 'D', 'E'];
    const target = ['D', 'A', 'E', 'B', 'C'];
    const forward = analyze({ source, target }, 0);
    const backward = analyze({ source: target, target: source }, 0);
    assert.equal(forward.inversions, backward.inversions);
    const renamed = renameIds(forward, { A: '红', B: '橙', C: '黄', D: '绿', E: '蓝' });
    assert.equal(analyze(renamed, 0).inversions, forward.inversions);
  });

  it('生成的最短见证可逐步重放到目标', () => {
    const source = ['A', 'B', 'C', 'D', 'E'];
    const target = ['C', 'A', 'E', 'B', 'D'];
    const result = analyze({ source, target }, 0);
    assert.equal(result.witness.steps.length, Number(result.inversions));
    assert.deepEqual(replayWitness(source, target, result.witness.steps), target);
  });

  it('拒绝越界和非相邻交换', () => {
    const steps = generateWitness(['A', 'B'], ['B', 'A']);
    steps[0]!.rightPosition = 3;
    assert.throws(() => replayWitness(['A', 'B'], ['B', 'A'], steps), (error: unknown) => error instanceof AppError);
  });

  it('SQLite 持久化报告，修改输入创建新报告', () => {
    const directory = mkdtempSync(join(tmpdir(), 'kendall-'));
    const store = new Store(join(directory, 'test.sqlite'));
    const first = store.saveAnalysis(analyze({ source: ['A', 'B'], target: ['B', 'A'] }, 0));
    const second = store.saveAnalysis(analyze({ source: ['A', 'B', 'C'], target: ['C', 'B', 'A'] }, 0));
    assert.notEqual(first.report.id, second.report.id);
    assert.equal(store.getReport(first.report.id)!.inversions, '1');
    assert.equal(store.getReport(second.report.id)!.inversions, '3');
    store.close();
  });
});
