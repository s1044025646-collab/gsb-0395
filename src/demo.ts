import { analyze, countInversionsEnumeration, replayWitness } from './kendall.js';

const demo = analyze({ source: ['A', 'B', 'C'], target: ['B', 'C', 'A'] }, 10);
console.log('演示 [A,B,C] -> [B,C,A]');
console.log(`距离: ${demo.inversions}，总元素对: ${demo.totalPairs}，归一化: ${demo.normalizedDistance}`);
console.log('见证:');
for (const step of demo.witness.steps) {
  console.log(`  ${step.step}. 交换位置 ${step.leftPosition}/${step.rightPosition}: ${step.leftId} <-> ${step.rightId}`);
}
replayWitness(demo.source, demo.target, demo.witness.steps);

for (const n of [0, 1, 2, 5, 10]) {
  const source = Array.from({ length: n }, (_, index) => String(index + 1));
  const reverse = analyze({ source, target: source.slice().reverse() }, 0);
  const enumerated = countInversionsEnumeration(reverse.mappedPositions.map(BigInt));
  console.log(`反序 n=${n}: 距离 ${reverse.inversions} / 总对数 ${reverse.totalPairs}，二次枚举核对 ${enumerated.toString()}`);
}
