import { createHash } from 'node:crypto';
import { config } from './config.js';
import { AppError } from './errors.js';

export interface EmbeddingProvider {
  embedQuery(text: string): Promise<number[]>;
  embedDocuments(texts: string[]): Promise<number[][]>;
}

type Extractor = (
  texts: string[],
  options: { pooling: 'mean'; normalize: true; truncation: true; max_length: number },
) => Promise<{ tolist(): number[][] }>;

/** One lazily loaded model and a serialized inference lane per process. */
export class LocalE5EmbeddingProvider implements EmbeddingProvider {
  private modelPromise: Promise<Extractor> | undefined;
  private lane: Promise<unknown> = Promise.resolve();
  private cache = new Map<string, number[]>();
  private state: 'not_loaded' | 'loading' | 'ready' | 'error' = 'not_loaded';
  private lastError: string | undefined;

  getStatus() {
    return {
      state: this.state,
      modelId: config.modelId,
      dimensions: config.dimensions,
      version: config.embeddingVersion,
      error: this.lastError,
    };
  }

  private async model(): Promise<Extractor> {
    if (!this.modelPromise) {
      this.state = 'loading';
      this.lastError = undefined;
      this.modelPromise = (async () => {
        const { pipeline, env } = await import('@huggingface/transformers');
        env.cacheDir = config.cacheDir;
        // The published Xenova ONNX model supports quantized CPU inference.
        const extractor = await pipeline('feature-extraction', config.modelId, {
          dtype: 'q8',
          device: 'cpu',
          revision: config.modelRevision,
        });
        this.state = 'ready';
        return extractor as unknown as Extractor;
      })().catch((error: unknown) => {
        this.state = 'error';
        this.lastError = error instanceof Error ? error.message : String(error);
        this.modelPromise = undefined; // A later explicit user request can retry a failed download.
        throw new AppError(
          503,
          'MODEL_UNAVAILABLE',
          'Не удалось загрузить embedding-модель. Проверьте доступ к Hugging Face и к каталогу кеша. Фиктивный поиск не используется.',
          { reason: this.lastError },
        );
      });
    }
    return this.modelPromise;
  }

  private async extract(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    const task = this.lane.then(async () => {
      const extractor = await this.model();
      const results: number[][] = [];
      for (let offset = 0; offset < texts.length; offset += config.batchSize) {
        const batch = texts.slice(offset, offset + config.batchSize);
        try {
          const output = await extractor(batch, {
            pooling: 'mean',
            normalize: true,
            truncation: true,
            max_length: 512,
          });
          const vectors = output.tolist();
          if (vectors.length !== batch.length)
            throw new Error('Количество векторов не совпадает с количеством текстов.');
          for (const vector of vectors) {
            if (vector.length !== config.dimensions || !vector.every(Number.isFinite))
              throw new Error('Некорректная размерность или значения вектора.');
            const norm = Math.hypot(...vector);
            if (norm < 1e-12) throw new Error('Модель вернула нулевой вектор.');
            results.push(vector.map((value) => value / norm));
          }
        } catch (error) {
          if (error instanceof AppError) throw error;
          throw new AppError(
            503,
            'EMBEDDING_FAILED',
            'Не удалось вычислить embeddings. Повторите запрос после проверки модели.',
            { reason: error instanceof Error ? error.message : String(error) },
          );
        }
      }
      return results;
    });
    this.lane = task.catch(() => undefined);
    return task;
  }

  async embedQuery(text: string): Promise<number[]> {
    const key = createHash('sha256')
      .update(`${config.modelId}|${config.embeddingVersion}|query: ${text}`)
      .digest('hex');
    const cached = this.cache.get(key);
    if (cached) return [...cached];
    const [vector] = await this.extract([`query: ${text}`]);
    this.cache.set(key, vector!);
    if (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value!);
    return [...vector!];
  }

  embedDocuments(texts: string[]): Promise<number[][]> {
    return this.extract(texts.map((text) => `passage: ${text}`));
  }
}

export const embeddingProvider = new LocalE5EmbeddingProvider();
