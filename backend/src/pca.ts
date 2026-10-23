import { createHash } from 'node:crypto';
import { AppError } from './errors.js';

export interface PcaTransform {
  mean: number[];
  components: [number[], number[]];
  explainedVarianceRatio: [number, number];
}

const dot = (a: number[], b: number[]) =>
  a.reduce((sum, value, index) => sum + value * b[index]!, 0);
const normalize = (v: number[]) => {
  const norm = Math.hypot(...v);
  return norm > 1e-14 ? v.map((x) => x / norm) : v.map(() => 0);
};

/** Deterministic two-component PCA using covariance products, without random initial vectors. */
export function fitPca(vectors: number[][]): PcaTransform {
  if (vectors.length < 2)
    throw new AppError(
      409,
      'PCA_INSUFFICIENT_DATA',
      'Для PCA нужны как минимум два проиндексированных тендера.',
    );
  const dimensions = vectors[0]!.length;
  if (!dimensions || vectors.some((v) => v.length !== dimensions || !v.every(Number.isFinite)))
    throw new Error('PCA получил несовместимые векторы.');
  const mean = Array.from(
    { length: dimensions },
    (_, d) => vectors.reduce((s, v) => s + v[d]!, 0) / vectors.length,
  );
  const centered = vectors.map((v) => v.map((x, d) => x - mean[d]!));
  const varianceByDimension = mean.map((_, d) => centered.reduce((s, v) => s + v[d]! ** 2, 0));
  const totalVariance = varianceByDimension.reduce((a, b) => a + b, 0);
  const components: number[][] = [];
  const eigenvalues: number[] = [];
  const covarianceProduct = (v: number[]) => {
    const result = Array<number>(dimensions).fill(0);
    for (const row of centered) {
      const weight = dot(row, v);
      for (let d = 0; d < dimensions; d++) result[d]! += row[d]! * weight;
    }
    return result;
  };
  for (let component = 0; component < 2; component++) {
    let vector = normalize(
      Array.from({ length: dimensions }, (_, d) =>
        Math.sin((d + 1) * (component + 1) * 1.61803398875),
      ),
    );
    for (let iteration = 0; iteration < 500; iteration++) {
      let next = covarianceProduct(vector);
      for (const previous of components) {
        const projection = dot(next, previous);
        next = next.map((x, d) => x - projection * previous[d]!);
      }
      next = normalize(next);
      const convergence = Math.abs(dot(next, vector));
      vector = next;
      if (convergence > 1 - 1e-11) break;
    }
    // Eigenvector signs are arbitrary. Lock each sign by its largest absolute loading.
    const pivot = vector.reduce(
      (best, value, index) => (Math.abs(value) > Math.abs(vector[best]!) ? index : best),
      0,
    );
    if (vector[pivot]! < 0) vector = vector.map((x) => -x);
    components.push(vector);
    eigenvalues.push(Math.max(0, dot(vector, covarianceProduct(vector))));
  }
  return {
    mean,
    components: components as [number[], number[]],
    explainedVarianceRatio: eigenvalues.map((v) => (totalVariance > 0 ? v / totalVariance : 0)) as [
      number,
      number,
    ],
  };
}

export function projectPca(vector: number[], transform: PcaTransform): [number, number] {
  if (vector.length !== transform.mean.length)
    throw new Error('Размерность запроса не соответствует PCA.');
  const centered = vector.map((x, index) => x - transform.mean[index]!);
  return transform.components.map((component) => dot(centered, component)) as [number, number];
}

export class PcaCache {
  private key: string | undefined;
  private transform: PcaTransform | undefined;
  get(
    rows: { id: string; vector: number[]; contentHash: string; embeddedAt: string }[],
  ): PcaTransform {
    const key = createHash('sha256')
      .update(rows.map((row) => `${row.id}:${row.contentHash}:${row.embeddedAt}`).join('|'))
      .digest('hex');
    if (key !== this.key || !this.transform) {
      this.transform = fitPca(rows.map((row) => row.vector));
      this.key = key;
    }
    return this.transform;
  }
}
